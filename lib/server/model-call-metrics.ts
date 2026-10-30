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

export interface ModelCallContext {
  sessionId: string | null;
  source: CallSource;
  purpose: CallPurpose;
}

export type ModelCallContextResolver = (context: unknown) => ModelCallContext | null;

export interface ModelCallClock {
  now: () => number;
  wallNow: () => number;
}

export interface WrapModelCallMetricsOptions {
  resolveContext?: ModelCallContextResolver;
  clock?: ModelCallClock;
  record?: (input: ModelCallInsert) => void;
  bindCallId?: (callId: string | null) => void;
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
  cleanup: (() => void) | null;
  releaseBinding: (() => void) | null;
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
    cleanup: null,
    releaseBinding: null,
  };
}

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

function readReportedOutputTokens(message: AssistantMessage | undefined): number | null {
  const usage = message?.usage;
  if (!usage) return null;
  const counters = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens];
  const reported = counters.some((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
    || typeof usage.reasoning === "number";
  if (!reported) return null;
  return isValidTokenCount(usage.output) ? usage.output : null;
}

const SUCCESS_REASONS = new Set(["stop", "length", "toolUse", "tool_use", "deferred", "completed"]);

function terminalStatus(
  state: CallState,
  reason: string | undefined,
  signalMeansCancel = true,
): CallStatus {
  if (reason === "aborted") return "cancelled";
  if (signalMeansCancel && state.signal?.aborted) return "cancelled";
  if (reason === "error" || (reason !== undefined && !SUCCESS_REASONS.has(reason))) return "failed";
  return "completed";
}

function nonNegativeDurationMs(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null;
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

  const durationMs = nonNegativeDurationMs(terminal.at - state.startMonotonic);
  const hasOutput = state.firstOutputAt !== null && state.lastOutputAt !== null;
  const ttftMs =
    state.firstOutputAt !== null
      ? nonNegativeDurationMs(state.firstOutputAt - state.startMonotonic)
      : null;
  const generationDurationMs = hasOutput
    ? nonNegativeDurationMs((state.lastOutputAt as number) - (state.firstOutputAt as number))
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
    ttftMs,
    generationDurationMs,
    durationMs,
    outputTokens: readReportedOutputTokens(terminal.message),
    error: terminal.status === "completed" ? null : errorText(terminal.error, terminal.message),
  };

  try {
    record(insert);
  } catch (error) {
    log.warn("model-call metrics record failed", {
      callId: state.callId,
      sessionId: state.context.sessionId,
      error: String(error),
    });
  } finally {
    try {
      state.cleanup?.();
    } catch {
    }
    state.cleanup = null;
    try {
      state.releaseBinding?.();
    } catch {
    }
    state.releaseBinding = null;
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
      status: terminalStatus(state, message?.stopReason, false),
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
  const originalPushValue = target.push;
  const originalPush = originalPushValue.bind(target);
  const hadOwnPush = Object.prototype.hasOwnProperty.call(target, "push");
  const patchedPush = (event: ObservedEvent) => {
    try {
      observeEvent(state, event, clock);
      if (event.type === "done") {
        finish(
          state,
          {
            status: terminalStatus(state, event.reason, false),
            at: clock.now(),
            message: asMessage(event.message),
          },
          clock,
          record,
        );
      } else if (event.type === "error") {
        finish(
          state,
          {
            status: terminalStatus(state, event.reason),
            at: clock.now(),
            message: asMessage(event.error),
            error: event.error,
          },
          clock,
          record,
        );
      }
    } catch {
    }
    originalPush(event);
  };
  target.push = patchedPush;
  state.cleanup = () => {
    if (target.push !== patchedPush) return;
    if (hadOwnPush) target.push = originalPushValue;
    else delete (target as { push?: unknown }).push;
  };

  void target.result().then(
    (message) => finishCompleted(state, message, clock, record),
    (error) => finishThrown(state, error, clock, record),
  );
}

function callArgs(args: unknown[]): {
  model: ModelLike | undefined;
  context: unknown;
  options: StreamOptionsLike | undefined;
} {
  return {
    model: args[0] as ModelLike | undefined,
    context: args[1],
    options: args[2] as StreamOptionsLike | undefined,
  };
}

export function wrapModelCallMetrics(
  runtime: ModelRuntime,
  options: WrapModelCallMetricsOptions = {},
): ModelRuntime {
  const clock: ModelCallClock = options.clock ?? defaultClock;
  const resolveContext = options.resolveContext ?? (() => null);
  const record = options.record ?? recordModelCall;
  const bindCallId = options.bindCallId;
  const createCallId = (): string => randomUUID();

  const wrapStreamCall = (
    target: ModelRuntime,
    method: "stream" | "streamSimple",
    args: unknown[],
  ): unknown => {
    let state: CallState | null = null;
    try {
      const { model, context, options: callOptions } = callArgs(args);
      state = createState(model, resolveContext(context), clock, createCallId, callOptions);
    } catch (error) {
      log.warn("model-call metrics setup failed", { error: String(error) });
    }
    if (state && bindCallId) {
      const boundCallId = state.callId;
      try {
        bindCallId(boundCallId);
        state.releaseBinding = () => bindCallId(null);
      } catch (error) {
        log.warn("model-call metrics call id binding failed", {
          callId: boundCallId,
          error: String(error),
        });
      }
    }
    const fn = Reflect.get(target, method, target) as (...a: unknown[]) => unknown;
    try {
      const stream = fn.apply(target, args);
      if (state) {
        try {
          observeStream(stream, state, clock, record);
        } catch (error) {
          try {
            state.cleanup?.();
          } catch {
          }
          state.cleanup = null;
          log.warn("model-call metrics observation failed", {
            callId: state.callId,
            error: String(error),
          });
        }
      }
      return stream;
    } catch (error) {
      if (state) finishThrown(state, error, clock, record);
      throw error;
    }
  };

  return new Proxy(runtime, {
    get(target, prop, receiver) {
      if (prop === "stream" || prop === "streamSimple") {
        return (...args: unknown[]) => wrapStreamCall(target, prop, args);
      }
      if (prop === "complete" || prop === "completeSimple") {
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
