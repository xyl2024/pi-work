/**
 * Turn orchestration: acquire a session (fresh, or an existing one the caller
 * names), prepare it in the right order, deliver the prompt, wait until the
 * turn has *really* finished, classify the result and clean up.
 *
 * This is the active half of the turn module (see
 * docs/adr/0004-turn-execution-has-one-seam-and-waits-for-agent-settled.md).
 * The ordering knowledge lives here — install the terminal listener BEFORE
 * dispatching the prompt; apply model/thinking BEFORE the prompt — because
 * those orderings are part of "what a turn is", not of any caller. The tool
 * set is not a command this module sends: it is baked into the session at
 * acquisition, so it is forwarded to the session factory instead.
 *
 * No side effects live here: notifications, logs and channel
 * state stay with the callers. Options are genuinely optional — an absent
 * model/thinking simply sends no setup command and defers to the session
 * sidecar / cwd defaults; the module never invents a default.
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
import type { CallPurpose, ModelCallCommandOptions } from "../../shared/token-audit-types";
import type { MessageOrigin } from "../../shared/message-origin";

/** Optional per-command attribution for the session's model calls. */
export type TurnSendOptions = ModelCallCommandOptions;

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
  send(command: Record<string, unknown>, options?: TurnSendOptions): Promise<unknown>;
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

/**
 * How the turn gets its session. `fresh` opens a new one; `reuse` continues an
 * existing session id — the caller's policy, since wechat is the only caller
 * that continues an existing conversation (ADR-0004).
 */
export type TurnSessionPolicy =
  | { kind: "fresh" }
  | { kind: "reuse"; sessionId: string };

/** Audit sources accepted by the turn module; identical to the shared
 *  LlmAuditSource union (re-exported so callers can import it from here). */
export type { LlmAuditSource };

/**
 * The one dependency seam of the orchestration: how the turn's session is
 * acquired. Production wires this to `startRpcSession` (see `./rpc-factory`);
 * tests substitute a factory that yields scripted fake sessions.
 *
 * The policy is the caller's session strategy: `fresh` opens a session in
 * `cwd`, `reuse` continues an existing session id (the factory must return the
 * live session, or revive it from its file, never silently open a new one).
 */
export type TurnSessionFactory = (
  cwd: string,
  toolNames: ToolSelection | undefined,
  source: LlmAuditSource,
  policy: TurnSessionPolicy,
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
   * Optional tool selection handed to the session factory, which bakes it in
   * while acquiring the session (this module sends no tool command).
   * `undefined` lets the factory apply its own default (sidecar / cwd
   * default) — the module never invents a tool set for the caller.
   */
  toolNames?: ToolSelection;
  /** Who is running this turn (LLM-audit attribution). Defaults to "user". */
  source?: LlmAuditSource;
  /**
   * What this turn's model calls are for (LLM-audit attribution). Omitted lets
   * the session's own default stand (chat) — a channel message names `channel`
   * while keeping its user source.
   */
  purpose?: CallPurpose;
  /**
   * 消息来源（ADR-0023）：由非网页发送方（定时任务、频道、子代理补输入）填
   * 好、随 prompt 命令原样转发给收口点；prompt 文本本身永远不因它改变。
   * 缺省（网页端）不传。
   */
  origin?: MessageOrigin;
  /**
   * Session strategy. Defaults to `{ kind: "fresh" }`: a new session in `cwd`.
   * `{ kind: "reuse", sessionId }` continues that session — the factory hands
   * back the live one when it is still running, revives it from its file when
   * its process is gone, and fails loudly when there is no such session.
   *
   * Cleanup does not depend on the policy: a failed setup or the caller's
   * deadline destroys the session, a reused one included. A caller that must
   * keep a shared session running after a timeout should not route it through
   * `runTurn` yet.
   */
  session?: TurnSessionPolicy;
  /** Caller-owned deadline in ms; the session is destroyed when it fires. */
  timeoutMs: number;
  /**
   * Optional stop policy: any source firing cancels this turn — the module
   * tells the session to abort and returns `cancelled` at once, without waiting
   * for `timeoutMs`. A source already aborted at call time cancels before the
   * prompt is ever dispatched. Absent/empty leaves today's behaviour unchanged.
   */
  abortSources?: TurnAbortSource[];
  /**
   * Whether a stop (deadline or abort source) must be *confirmed* before the
   * result is reported. With `false` (the default) a stop settles immediately
   * and a deadline destroys the wrapper. With `true` the module asks the
   * session to abort and keeps waiting for its own terminal event, so the
   * caller only ever sees `timeout` / `cancelled` once the turn really stopped;
   * the wrapper is not destroyed on the caller's behalf, because a destroyed
   * wrapper is not proof the underlying turn stopped. A caller that needs the
   * answer "is it still running?" (subagent tasks) opts in; everyone else
   * keeps the immediate semantics.
   */
  confirmStop?: boolean;
  /**
   * Called once, right after the session is acquired and before any setup
   * command or the prompt reaches it. Lets a caller that must address the
   * live session while the turn is running (to abort it, or to link it from a
   * run record) learn its ids. The module performs no side effect here — the
   * caller owns whatever it does with the ids.
   */
  onSession?: (ids: { sessionId: string; realSessionId: string }) => void;
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
  /**
   * Optional stop policy: any source firing cancels the turn. The module tells
   * the session to abort (so the turn really stops, rather than being merely
   * labelled) and settles as `cancelled` at once, without waiting for the
   * deadline. Absent/empty leaves today's behaviour untouched.
   */
  abortSources?: TurnAbortSource[];
  /**
   * Confirm a stop before reporting it (see `RunTurnSpec.confirmStop`). With
   * this set, a deadline or abort source asks the session to abort and settles
   * only when the session reports its own terminal event; nothing is destroyed
   * on the caller's behalf. An already-aborted source still settles at once —
   * nothing started, so there is nothing to confirm.
   */
  confirmStop?: boolean;
}

/**
 * A side condition under which the turn must be cancelled. The caller owns the
 * signal and the wording (parent stopped, parent session closed, the parent
 * agent's own abort, …); the module only executes it.
 */
export interface TurnAbortSource {
  signal: AbortSignal;
  /** Human-readable reason recorded as the cancelled result's `error`. */
  reason: string;
}

/**
 * Observe one already-running session until its current turn has really
 * finished (`agent_settled`), then report the neutral terminal state.
 *
 * Delivers NO command to the session on its own — not even an abort — unless
 * the caller hands it `abortSources`: any one of those firing tells the session
 * to abort and settles as `cancelled` immediately. A destroyed session
 * converges to `interrupted`. When `timeoutMs` is given, the deadline is the
 * caller's policy executed here: the session is destroyed and the result is
 * `timeout`. Without `timeoutMs` the session is never touched by a deadline.
 * With `confirmStop`, a deadline or abort source instead asks the session to
 * abort and settles only on its own terminal event, so the reported state is
 * always one the session actually reached.
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
    let timer: ReturnType<typeof setTimeout> | null = null;
    let removeEventListener: () => void = () => {};
    let removeDestroyListener: () => void = () => {};
    let removeAbortListeners: () => void = () => {};
    /** The stop the caller asked for, once one was requested (confirm mode). */
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

    // Both listeners are installed synchronously inside the Promise executor —
    // for watchSettled the turn may be mid-flight already, so there is no
    // "before the prompt" moment to be late for.
    // A requested stop does not become the answer on its own: the turn's own
    // terminal event confirms the session actually stopped. Until then the
    // caller keeps seeing "no result yet", which is the honest state.
    const requestStop = (reason: TurnEndReason) => {
      if (done || requestedStop) return;
      requestedStop = reason;
      // Best-effort, exactly like the pre-seam abort path: the abort completes
      // asynchronously and the session's JSONL still records the stop.
      void Promise.resolve(session.send({ type: "abort" })).catch(() => undefined);
    };

    removeEventListener = session.onEvent((event) => {
      snapshot = observeTurnEvent(snapshot, event);
      const reason = eventTurnEndReason(event);
      if (!reason) return;
      if (requestedStop && reason.kind === "settled") {
        // A stop request races the turn's own end. If the session actually
        // finished with a real reply in the meantime, that answer wins: a late
        // stop must not overwrite a landed result with `timeout`/`cancelled`.
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
          // Ask the session to stop and keep the wait alive: the result stays
          // unreported until the turn settles or the wrapper is destroyed.
          requestStop({ kind: "timeout", deadlineMs });
          return;
        }
        // Decide the outcome BEFORE destroying the session. The wrapper runs
        // its onDestroy callbacks synchronously, and a caller may have wired
        // one of them to a stop source (the subagent path wires the child
        // session's destruction that way). Finishing first removes every
        // listener — including this wait's own — so that teardown cannot
        // settle the wait as `interrupted` or `cancelled` instead.
        finish({ kind: "timeout", deadlineMs });
        session.destroy();
      }, deadlineMs);
    }

    // Abort sources are the caller's stop policy executed here, just like the
    // deadline: any one firing tells the session to abort — so the turn really
    // stops and no running session is left behind — and settles the wait as
    // `cancelled` right away. `finish`'s `done` guard is what keeps the events
    // the abort itself provokes (a settled/aborted agent_end) from reporting a
    // second terminal state.
    if (options.abortSources?.length) {
      const removeFns: Array<() => void> = [];
      const cancel = (source: TurnAbortSource) => {
        if (options.confirmStop) {
          requestStop({ kind: "cancelled", reason: source.reason });
          return;
        }
        // Best-effort, exactly like the pre-seam subagent path: the abort
        // completes asynchronously and its JSONL still records the stop.
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
      // A signal aborted before this call never fires its listener; converge at
      // once instead of hanging until the session settles on its own. This is
      // the one stop reported without confirmation: the turn had not started,
      // so there is nothing left running to confirm.
      for (const source of options.abortSources) {
        if (source.signal.aborted) {
          // Still tell the session to stop (kept from the pre-confirm
          // behaviour), then report at once: nothing was prompted, so there is
          // nothing left running to confirm.
          void Promise.resolve(session.send({ type: "abort" })).catch(() => undefined);
          finish({ kind: "cancelled", reason: source.reason });
          break;
        }
      }
    }
  });
}

/**
 * Run one complete turn:
 * acquire (fresh, or the existing session the caller named; the factory also
 * bakes in the tool set) → apply optional model/thinking → install the
 * terminal listener → deliver the prompt → wait for the turn to really finish
 * → return the neutral result.
 *
 * The waiting reuses `watchSettled`, so there is exactly one terminal-state
 * judgement. Cleanup: a failed setup or a timed-out wait destroys the
 * session; a cancel from one of the caller's abort sources instead tells the
 * session to abort and returns `cancelled`. Factory failures propagate to the
 * caller. No side effects are owned here — notifications, logs and channel
 * state belong to the caller.
 */
export async function runTurn(spec: RunTurnSpec, createSession: TurnSessionFactory): Promise<TurnResult> {
  // Session acquisition: the factory owns registry keys and pi's own ids.
  // toolNames stays `undefined` when the caller did not specify it.
  const policy: TurnSessionPolicy = spec.session ?? { kind: "fresh" };
  const { session, sessionId, realSessionId } = await createSession(
    spec.cwd,
    spec.toolNames,
    spec.source ?? "user",
    policy,
  );
  const ids = { sessionId, realSessionId };

  // Model / thinking must be in place BEFORE the prompt (the tool set is
  // already in place: the factory applied it at acquisition). Each option is
  // genuinely optional: absent → no command at all, and the session's own
  // defaults (sidecar, cwd config) stand.
  try {
    // Announce the live session before anything touches it: a caller that
    // needs to cancel or link this run has the ids from here on. Kept inside
    // the try so a throwing callback tears the session down instead of
    // leaking it.
    spec.onSession?.(ids);
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
  const watched = watchSettled(session, {
    timeoutMs: spec.timeoutMs,
    ...(spec.abortSources ? { abortSources: spec.abortSources } : {}),
    ...(spec.confirmStop ? { confirmStop: true } : {}),
  });

  // A turn cancelled before its prompt is dispatched never starts one: the
  // watcher has already told the session to abort and settled as `cancelled`,
  // so sending the prompt now would leave a running session nobody stops.
  if (spec.abortSources?.some((source) => source.signal.aborted)) {
    return { ...(await watched), ...ids };
  }

  try {
    await session.send(
      { type: "prompt", message: spec.prompt, ...(spec.origin ? { origin: spec.origin } : {}) },
      spec.purpose ? { purpose: spec.purpose } : undefined,
    );
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
