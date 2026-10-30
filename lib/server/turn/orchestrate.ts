import {
  classifyTurnEnd,
  eventTurnEndReason,
  observeTurnEvent,
  EMPTY_TURN_SNAPSHOT,
  type TurnEndReason,
  type TurnEvent,
  type TurnOutcome,
  type TurnSnapshot,
} from "./outcome";
import type { ToolSelection } from "../../shared/types";
import type { LlmAuditSource } from "../../shared/llm-audit-types";
import type { CallPurpose, ModelCallCommandOptions } from "../../shared/token-audit-types";
import type { MessageOrigin } from "../../shared/message-origin";

export type TurnSendOptions = ModelCallCommandOptions;

export interface TurnSession {
  readonly sessionId: string;
  onEvent(listener: (event: TurnEvent) => void): () => void;
  onDestroy(cb: () => void): () => void;
  send(command: Record<string, unknown>, options?: TurnSendOptions): Promise<unknown>;
  destroy(): void;
}

export interface AcquiredTurnSession {
  session: TurnSession;
  sessionId: string;
  realSessionId: string;
}

export type TurnSessionPolicy =
  | { kind: "fresh" }
  | { kind: "reuse"; sessionId: string };

export type { LlmAuditSource };

export type TurnSessionFactory = (
  cwd: string,
  toolNames: ToolSelection | undefined,
  source: LlmAuditSource,
  policy: TurnSessionPolicy,
) => Promise<AcquiredTurnSession>;

export interface RunTurnSpec {
  cwd: string;
  prompt: string;
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
  toolNames?: ToolSelection;
  source?: LlmAuditSource;
  origin?: MessageOrigin;
  purpose?: CallPurpose;
  session?: TurnSessionPolicy;
  timeoutMs: number;
  abortSources?: TurnAbortSource[];
  confirmStop?: boolean;
  onSession?: (ids: { sessionId: string; realSessionId: string }) => void;
}

export interface TurnResult extends TurnOutcome {
  sessionId: string;
  realSessionId: string;
}

export interface WatchSettledOptions {
  timeoutMs?: number;
  abortSources?: TurnAbortSource[];
  confirmStop?: boolean;
}

export interface TurnAbortSource {
  signal: AbortSignal;
  reason: string;
}

export async function watchSettled(session: TurnSession, options: WatchSettledOptions = {}): Promise<TurnResult> {
  const ids = { sessionId: session.sessionId, realSessionId: session.sessionId };

  return await new Promise<TurnResult>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let removeEventListener: () => void = () => {};
    let removeDestroyListener: () => void = () => {};
    let removeAbortListeners: () => void = () => {};
    let requestedStop: TurnEndReason | null = null;

    const finish = (reason: TurnEndReason) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      removeEventListener();
      removeDestroyListener();
      removeAbortListeners();
      resolve({ ...classifyTurnEnd(snapshot, reason), ...ids });
    };

    let snapshot: TurnSnapshot = EMPTY_TURN_SNAPSHOT;

    const requestStop = (reason: TurnEndReason) => {
      if (done || requestedStop) return;
      requestedStop = reason;
      void Promise.resolve(session.send({ type: "abort" })).catch(() => undefined);
    };

    removeEventListener = session.onEvent((event) => {
      snapshot = observeTurnEvent(snapshot, event);
      const reason = eventTurnEndReason(event);
      if (!reason) return;
      if (requestedStop && reason.kind === "settled") {
        const natural = classifyTurnEnd(snapshot, reason);
        if (natural.status === "completed" && natural.hasReply) {
          finish(reason);
          return;
        }
      }
      finish(requestedStop ?? reason);
    });
    removeDestroyListener = session.onDestroy(() => {
      finish({ kind: "interrupted" });
    });

    if (options.timeoutMs !== undefined) {
      const deadlineMs = options.timeoutMs;
      timer = setTimeout(() => {
        if (options.confirmStop) {
          requestStop({ kind: "timeout", deadlineMs });
          return;
        }
        finish({ kind: "timeout", deadlineMs });
        session.destroy();
      }, deadlineMs);
    }

    if (options.abortSources?.length) {
      const removeFns: Array<() => void> = [];
      const cancel = (source: TurnAbortSource) => {
        if (options.confirmStop) {
          requestStop({ kind: "cancelled", reason: source.reason });
          return;
        }
        void Promise.resolve(session.send({ type: "abort" })).catch(() => undefined);
        finish({ kind: "cancelled", reason: source.reason });
      };
      for (const source of options.abortSources) {
        const onAbort = () => cancel(source);
        source.signal.addEventListener("abort", onAbort, { once: true });
        removeFns.push(() => source.signal.removeEventListener("abort", onAbort));
      }
      removeAbortListeners = () => {
        for (const remove of removeFns) remove();
      };
      for (const source of options.abortSources) {
        if (source.signal.aborted) {
          void Promise.resolve(session.send({ type: "abort" })).catch(() => undefined);
          finish({ kind: "cancelled", reason: source.reason });
          break;
        }
      }
    }
  });
}

export async function runTurn(spec: RunTurnSpec, createSession: TurnSessionFactory): Promise<TurnResult> {
  const policy: TurnSessionPolicy = spec.session ?? { kind: "fresh" };
  const { session, sessionId, realSessionId } = await createSession(
    spec.cwd,
    spec.toolNames,
    spec.source ?? "user",
    policy,
  );
  const ids = { sessionId, realSessionId };

  try {
    spec.onSession?.(ids);
    if (spec.model) {
      await session.send({ type: "set_model", provider: spec.model.provider, modelId: spec.model.modelId });
    }
    if (spec.thinkingLevel !== undefined) {
      await session.send({ type: "set_thinking_level", level: spec.thinkingLevel });
    }
  } catch (error) {
    session.destroy();
    throw error;
  }

  const watched = watchSettled(session, {
    timeoutMs: spec.timeoutMs,
    ...(spec.abortSources ? { abortSources: spec.abortSources } : {}),
    ...(spec.confirmStop ? { confirmStop: true } : {}),
  });

  if (spec.abortSources?.some((source) => source.signal.aborted)) {
    return { ...(await watched), ...ids };
  }

  try {
    await session.send(
      { type: "prompt", message: spec.prompt, ...(spec.origin ? { origin: spec.origin } : {}) },
      spec.purpose ? { purpose: spec.purpose } : undefined,
    );
  } catch (error) {
    session.destroy();
    return { ...classifyTurnEnd(EMPTY_TURN_SNAPSHOT, { kind: "failed", error: errorMessage(error) }), ...ids };
  }

  const result = await watched;
  return { ...result, ...ids };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
