/**
 * Logical model-call metrics: TTFT, generation window and throughput facts.
 *
 * The observation boundary is one `ModelRuntime` generation operation
 * (`stream` / `streamSimple`, and the `complete*` helpers built on them), not a
 * turn, a browser event or an HTTP attempt. Wrapping the runtime means the
 * agent loop's own retries/backoff stay inside one record, while a later
 * generation (e.g. after a tool ran) is a separate call.
 *
 * The wrapper only observes normalized output deltas and the final usage that
 * the SDK already produces. It never consumes the caller's stream twice, never
 * stores text/thinking/tool arguments, and never turns a storage failure into
 * a failed model call.
 */

import { randomUUID } from "node:crypto";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createLogger } from "./logger";
import { recordModelCall } from "./token-audit-store";
import { isValidTokenCount } from "../shared/model-call-metrics";
import type {
  CallPurpose,
  CallSource,
  CallStatus,
  ModelCallInsert,
} from "../shared/token-audit-types";

const log = createLogger("model-call-metrics");

/** Context resolved when the call starts (AsyncLocalStorage scope of the caller). */
export interface ModelCallContext {
  sessionId: string | null;
  source: CallSource;
  purpose: CallPurpose;
}

export type ModelCallContextResolver = () => ModelCallContext | null;

/** Monotonic clock for intervals; wall clock only for the start date/sorting. */
export interface ModelCallClock {
  /** Monotonic milliseconds (same epoch for start/first-output/terminal). */
  now: () => number;
  /** Epoch milliseconds, used for `started_at` only. */
  wallNow: () => number;
}

export interface WrapModelCallMetricsOptions {
  resolveContext?: ModelCallContextResolver;
  clock?: ModelCallClock;
  record?: (input: ModelCallInsert) => void;
  createCallId?: () => string;
  /** Wall-clock start; exposed for tests that need a deterministic date. */
  wallNow?: () => number;
}

const defaultClock: ModelCallClock = {
  now: () => performance.now(),
  wallNow: () => Date.now(),
};

const DEFAULT_CONTEXT: ModelCallContext = {
  sessionId: null,
  source: "unknown",
  purpose: "unknown",
};

interface ModelLike {
  provider?: string;
  id?: string;
  api?: string;
}

interface StreamOptionsLike {
  signal?: AbortSignal;
}

interface CallState {
  callId: string;
  startedAt: number;
  startMonotonic: number;
  context: ModelCallContext;
  provider: string;
  modelId: string;
  api: string | null;
  signal: AbortSignal | undefined;
  firstOutputAt: number | null;
  lastOutputAt: number | null;
  finalized: boolean;
}

type ObservedEvent = {
  type?: string;
  delta?: unknown;
  message?: AssistantMessage;
  error?: AssistantMessage;
  reason?: string;
};

function asMessage(value: unknown): AssistantMessage | undefined {
  return value && typeof value === "object" ? (value as AssistantMessage) : undefined;
}

function createState(
  model: ModelLike | undefined,
  context: ModelCallContext | null,
  clock: ModelCallClock,
  createCallId: () => string,
  options: StreamOptionsLike | undefined,
): CallState {
  return {
    callId: createCallId(),
    startedAt: clock.wallNow(),
    startMonotonic: clock.now(),
    context: context ?? DEFAULT_CONTEXT,
    provider: model?.provider || "unknown",
    modelId: model?.id || "unknown",
    api: model?.api ?? null,
    signal: options?.signal,
    firstOutputAt: null,
    lastOutputAt: null,
    finalized: false,
  };
}

/**
 * Effective output = a non-empty text/thinking/tool-argument delta. Empty
 * strings, whitespace-only *declarations*, block starts/ends, role markers,
 * heartbeats, usage and completion events never start the clock. A single
 * space is still output: we deliberately do not trim.
 */
function observeEvent(state: CallState, event: ObservedEvent, clock: ModelCallClock): void {
  if (state.finalized) return;
  if (event.type !== "text_delta" && event.type !== "thinking_delta" && event.type !== "toolcall_delta") {
    return;
  }
  if (typeof event.delta !== "string" || event.delta.length === 0) return;
  const at = clock.now();
  if (state.firstOutputAt === null) state.firstOutputAt = at;
  state.lastOutputAt = at;
}

/**
 * Provider-reported output usage, or `null` when the provider never reported.
 *
 * SDK adapters initialise `usage` with zero placeholders and only replace it
 * when the provider sends usage metadata. A final object that is still all
 * zeros is therefore indistinguishable from "not reported" (a genuine
 * all-zero report looks identical) — we treat it as missing instead of
 * claiming a real zero. Providers that report a reasoning breakdown are
 * considered reporting even when the counters are zero.
 */
export function readReportedOutputTokens(message: AssistantMessage | undefined): number | null {
  const usage = message?.usage;
  if (!usage) return null;
  const counters = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens];
  const reported = counters.some((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
    || typeof usage.reasoning === "number";
  if (!reported) return null;
  return isValidTokenCount(usage.output) ? usage.output : null;
}

function terminalStatus(reason: string | undefined): CallStatus {
  if (reason === "aborted") return "cancelled";
  if (reason === "error") return "failed";
  return "completed";
}

function statusFromError(state: CallState): CallStatus {
  return state.signal?.aborted ? "cancelled" : "failed";
}

function errorText(error: unknown, message: AssistantMessage | undefined): string | null {
  if (message?.errorMessage) return message.errorMessage;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return message?.stopReason === "error" || message?.stopReason === "aborted"
    ? message.stopReason
    : null;
}

function finish(
  state: CallState,
  terminal: { status: CallStatus; at: number; message?: AssistantMessage; error?: unknown },
  clock: ModelCallClock,
  record: (input: ModelCallInsert) => void,
): void {
  if (state.finalized) return;
  state.finalized = true;

  const durationMs = terminal.at - state.startMonotonic;
  const hasOutput = state.firstOutputAt !== null && state.lastOutputAt !== null;
  const ttftMs = state.firstOutputAt !== null ? state.firstOutputAt - state.startMonotonic : null;
  const generationDurationMs = hasOutput
    ? (state.lastOutputAt as number) - (state.firstOutputAt as number)
    : null;

  const insert: ModelCallInsert = {
    callId: state.callId,
    startedAt: state.startedAt,
    sessionId: state.context.sessionId,
    messageId: terminal.message?.timestamp !== undefined ? String(terminal.message.timestamp) : null,
    source: state.context.source,
    purpose: state.context.purpose,
    provider: state.provider,
    modelId: state.modelId,
    api: state.api,
    status: terminal.status,
    ttftMs: Number.isFinite(ttftMs) ? (ttftMs as number) : null,
    generationDurationMs: Number.isFinite(generationDurationMs) ? (generationDurationMs as number) : null,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    outputTokens: readReportedOutputTokens(terminal.message),
    error: terminal.status === "completed" ? null : errorText(terminal.error, terminal.message),
  };

  try {
    record(insert);
  } catch (error) {
    // Metrics must never change the outcome of the model call.
    log.warn("model-call metrics record failed", {
      callId: state.callId,
      sessionId: state.context.sessionId,
      error: String(error),
    });
  }
}

function finishCompleted(
  state: CallState,
  message: AssistantMessage | undefined,
  clock: ModelCallClock,
  record: (input: ModelCallInsert) => void,
): void {
  finish(
    state,
    {
      status: terminalStatus(message?.stopReason),
      at: clock.now(),
      message,
      error: message,
    },
    clock,
    record,
  );
}

function finishThrown(
  state: CallState,
  error: unknown,
  clock: ModelCallClock,
  record: (input: ModelCallInsert) => void,
): void {
  finish(state, { status: statusFromError(state), at: clock.now(), error }, clock, record);
}

/**
 * Observe an SDK event stream without taking it over.
 *
 * `push` is patched on the stream instance itself (providers and `lazyStream`
 * push into that object), so observation works whether the caller iterates,
 * awaits `result()`, or both. The stream object handed back to the caller is
 * the original one — same identity, same ordering, same final result.
 */
function observeStream(
  stream: unknown,
  state: CallState,
  clock: ModelCallClock,
  record: (input: ModelCallInsert) => void,
): void {
  const target = stream as {
    push: (event: ObservedEvent) => void;
    result: () => Promise<AssistantMessage>;
  };
  const originalPush = target.push.bind(target);
  target.push = (event: ObservedEvent) => {
    try {
      observeEvent(state, event, clock);
      if (event.type === "done") {
        finish(
          state,
          { status: "completed", at: clock.now(), message: asMessage(event.message) },
          clock,
          record,
        );
      } else if (event.type === "error") {
        finish(
          state,
          {
            status: terminalStatus(event.reason),
            at: clock.now(),
            message: asMessage(event.error),
            error: event.error,
          },
          clock,
          record,
        );
      }
    } catch {
      // Observation must never interfere with the provider stream.
    }
    originalPush(event);
  };

  // Fallback for streams that end without a done/error event reaching push
  // (e.g. `end(result)`-only producers). Idempotent with the push path.
  void target.result().then(
    (message) => finishCompleted(state, message, clock, record),
    (error) => finishThrown(state, error, clock, record),
  );
}

function callArgs(args: unknown[]): {
  model: ModelLike | undefined;
  options: StreamOptionsLike | undefined;
} {
  return {
    model: args[0] as ModelLike | undefined,
    options: args[2] as StreamOptionsLike | undefined,
  };
}

/**
 * Wrap a ModelRuntime so every logical generation is recorded once.
 *
 * Composition: `getAuditModelRuntime` puts this wrapper outside the LLM-API
 * audit wrapper, so provider/model stamping happens first and the context
 * resolver (AsyncLocalStorage) is read at call start.
 */
export function wrapModelCallMetrics(
  runtime: ModelRuntime,
  options: WrapModelCallMetricsOptions = {},
): ModelRuntime {
  const clock: ModelCallClock = options.clock ?? {
    now: defaultClock.now,
    wallNow: options.wallNow ?? defaultClock.wallNow,
  };
  const resolveContext = options.resolveContext ?? (() => null);
  const record = options.record ?? recordModelCall;
  const createCallId = options.createCallId ?? (() => randomUUID());

  const wrapStreamCall = (
    target: ModelRuntime,
    method: "stream" | "streamSimple",
    args: unknown[],
  ): unknown => {
    const { model, options: callOptions } = callArgs(args);
    const state = createState(model, resolveContext(), clock, createCallId, callOptions);
    const fn = Reflect.get(target, method, target) as (...a: unknown[]) => unknown;
    try {
      const stream = fn.apply(target, args);
      observeStream(stream, state, clock, record);
      return stream;
    } catch (error) {
      finishThrown(state, error, clock, record);
      throw error;
    }
  };

  return new Proxy(runtime, {
    get(target, prop, receiver) {
      if (prop === "stream" || prop === "streamSimple") {
        return (...args: unknown[]) => wrapStreamCall(target, prop, args);
      }
      if (prop === "complete" || prop === "completeSimple") {
        // `ModelRuntime.complete*` is exactly `stream*(...).result()`; going
        // through the stream lets us observe deltas without a second call.
        const streamMethod = prop === "complete" ? "stream" : "streamSimple";
        return (model: unknown, context: unknown, callOptions: unknown) => {
          const stream = wrapStreamCall(target, streamMethod, [model, context, callOptions]) as {
            result: () => Promise<AssistantMessage>;
          };
          return stream.result();
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as ModelRuntime;
}
