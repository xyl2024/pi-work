/**
 * Turn orchestration: open a session, prepare it in the right order, deliver
 * the prompt, wait until the turn has *really* finished, classify the result
 * and clean up.
 *
 * This is the active half of the turn module (see
 * docs/adr/0004-turn-execution-has-one-seam-and-waits-for-agent-settled.md).
 * The ordering knowledge lives here — install the terminal listener BEFORE
 * dispatching the prompt; set model/thinking/tools BEFORE the prompt — because
 * those orderings are part of "what a turn is", not of any caller.
 *
 * No side effects live here: notifications, inbox pushes, logs and channel
 * state stay with the callers. Options are genuinely optional — an absent
 * model/thinking/tools simply sends no setup command and defers to the
 * session sidecar / cwd defaults; the module never invents a default.
 */
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

/** Minimal live-session surface the orchestration drives. The real
 *  AgentSessionWrapper satisfies this structurally; tests substitute fakes. */
export interface TurnSession {
  /** The pi session id this wrapper serves (its registry key when alive). */
  readonly sessionId: string;
  /** Subscribe to the event stream. Returns the unsubscribe function. */
  onEvent(listener: (event: TurnEvent) => void): () => void;
  /** Callback fired when the wrapper is destroyed (session lost). */
  onDestroy(cb: () => void): () => void;
  /** Dispatch an RPC command (`set_model`, `set_thinking_level`, `prompt`, …). */
  send(command: Record<string, unknown>): Promise<unknown>;
  /** Force-destroy the wrapper (timeout cleanup). */
  destroy(): void;
}

/** What a session factory hands back: the live wrapper plus both id views. */
export interface AcquiredTurnSession {
  session: TurnSession;
  /** Id the caller uses to address the session (its registry key). */
  sessionId: string;
  /** Id pi itself assigned — the id recorded in run records and audit rows. */
  realSessionId: string;
}

/** Audit sources accepted by the turn module; identical to the shared
 *  LlmAuditSource union (re-exported so callers can import it from here). */
export type { LlmAuditSource };

/**
 * The one dependency seam of the orchestration: how a fresh turn session is
 * acquired. Production wires this to `startRpcSession`; tests substitute a
 * factory that yields scripted fake sessions.
 */
export type TurnSessionFactory = (
  cwd: string,
  toolNames: ToolSelection | undefined,
  source: LlmAuditSource,
) => Promise<AcquiredTurnSession>;

/** Everything a caller needs to say to run one turn. Everything except cwd,
 *  prompt and timeout is genuinely optional. */
export interface RunTurnSpec {
  /** Working directory the fresh session is created in. */
  cwd: string;
  /** The user prompt delivered to the agent. */
  prompt: string;
  /** Optional model applied via `set_model` before the prompt. */
  model?: { provider: string; modelId: string };
  /** Optional thinking level applied via `set_thinking_level` before the prompt. */
  thinkingLevel?: string;
  /**
   * Optional tool selection applied before the prompt. `undefined` sends no
   * command and lets the session factory apply its own default (sidecar /
   * cwd default) — the module never invents a tool set for the caller.
   */
  toolNames?: ToolSelection;
  /** Who is running this turn (LLM-audit attribution). Defaults to "user". */
  source?: LlmAuditSource;
  /** Caller-owned deadline in ms; the session is destroyed when it fires. */
  timeoutMs: number;
}

/** The neutral terminal state of one turn. */
export interface TurnResult extends TurnOutcome {
  /** Id the session is addressed by (registry key). */
  sessionId: string;
  /** Id pi assigned — what run records and audit rows carry. */
  realSessionId: string;
}

/** Options of the observe-only entry point. */
export interface WatchSettledOptions {
  /** Optional deadline in ms; the session is destroyed when it fires. */
  timeoutMs?: number;
}

/**
 * Observe one already-running session until its current turn has really
 * finished (`agent_settled`), then report the neutral terminal state.
 *
 * Delivers NO command to the session — not even an abort. A destroyed session
 * converges to `interrupted`. When `timeoutMs` is given, the deadline is the
 * caller's policy executed here: the session is destroyed and the result is
 * `timeout`. Without `timeoutMs` the session is never touched.
 *
 * Ids: an observe-only call sees the wrapper's `sessionId`, which in
 * production IS pi's real session id. `runTurn` overwrites both ids with the
 * factory's registry key / real-id pair, so callers of `runTurn` always get
 * the distinguished view.
 *
 * `runTurn` waits through this entry point too — there is exactly one
 * terminal-state judgement in the module.
 */
export async function watchSettled(session: TurnSession, options: WatchSettledOptions = {}): Promise<TurnResult> {
  const ids = { sessionId: session.sessionId, realSessionId: session.sessionId };

  return await new Promise<TurnResult>((resolve) => {
    let done = false;
    // True while the deadline itself is destroying the session — the wrapper's
    // destroy() runs its onDestroy callbacks synchronously, so without this
    // flag the timeout would be misreported as an external interruption.
    let destroyingForTimeout = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let removeEventListener: () => void = () => {};
    let removeDestroyListener: () => void = () => {};

    const finish = (reason: TurnEndReason) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      removeEventListener();
      removeDestroyListener();
      resolve({ ...classifyTurnEnd(snapshot, reason), ...ids });
    };

    let snapshot: TurnSnapshot = EMPTY_TURN_SNAPSHOT;

    // Both listeners are installed synchronously inside the Promise executor —
    // for watchSettled the turn may be mid-flight already, so there is no
    // "before the prompt" moment to be late for.
    removeEventListener = session.onEvent((event) => {
      snapshot = observeTurnEvent(snapshot, event);
      const reason = eventTurnEndReason(event);
      if (reason) finish(reason);
    });
    removeDestroyListener = session.onDestroy(() => {
      if (destroyingForTimeout) return;
      finish({ kind: "interrupted" });
    });

    if (options.timeoutMs !== undefined) {
      const deadlineMs = options.timeoutMs;
      timer = setTimeout(() => {
        destroyingForTimeout = true;
        session.destroy();
        finish({ kind: "timeout", deadlineMs });
      }, deadlineMs);
    }
  });
}

/**
 * Run one complete turn in a freshly opened session:
 * acquire → apply optional model/thinking/tools → install the terminal
 * listener → deliver the prompt → wait for the turn to really finish →
 * return the neutral result.
 *
 * The waiting reuses `watchSettled`, so there is exactly one terminal-state
 * judgement. Cleanup: a failed setup or a timed-out wait destroys the
 * session. Factory failures propagate to the caller. No side effects are
 * owned here — notifications, inbox pushes, logs and channel state belong to
 * the caller.
 */
export async function runTurn(spec: RunTurnSpec, createSession: TurnSessionFactory): Promise<TurnResult> {
  // Session acquisition: the factory owns registry keys and pi's own ids.
  // toolNames stays `undefined` when the caller did not specify it.
  const { session, sessionId, realSessionId } = await createSession(
    spec.cwd,
    spec.toolNames,
    spec.source ?? "user",
  );
  const ids = { sessionId, realSessionId };

  // Model / thinking / tools must be in place BEFORE the prompt. Each option
  // is genuinely optional: absent → no command at all, and the session's own
  // defaults (sidecar, cwd config) stand.
  try {
    if (spec.model) {
      await session.send({ type: "set_model", provider: spec.model.provider, modelId: spec.model.modelId });
    }
    if (spec.thinkingLevel !== undefined) {
      await session.send({ type: "set_thinking_level", level: spec.thinkingLevel });
    }
  } catch (error) {
    // A session whose setup failed is unusable by contract — tear it down so
    // it cannot pin a slot, and surface the reason to the caller.
    session.destroy();
    throw error;
  }

  // The terminal listener exists BEFORE the prompt is dispatched: a very
  // short turn may settle before any code after `send("prompt")` runs.
  // watchSettled installs its listeners synchronously inside the Promise
  // executor, so by the time the call below returns, the listener is live.
  const watched = watchSettled(session, { timeoutMs: spec.timeoutMs });

  try {
    await session.send({ type: "prompt", message: spec.prompt });
  } catch (error) {
    // The dispatch failed before pi even started — nothing will settle the
    // watcher on its own. Destroy the dead session now (releasing the slot
    // immediately instead of pinning it until the deadline) and fail the turn.
    // The still-pending `watched` promise resolves right after via the
    // onDestroy listener inside watchSettled; it is deliberately not awaited.
    session.destroy();
    return { ...classifyTurnEnd(EMPTY_TURN_SNAPSHOT, { kind: "failed", error: errorMessage(error) }), ...ids };
  }

  const result = await watched;
  return { ...result, ...ids };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
