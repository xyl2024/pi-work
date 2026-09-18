/**
 * Interaction gates — the one place a tool call stops and waits for the user.
 *
 * A gate is opened, decided, and torn down through this interface; the session
 * wrapper owns one instance and the `tool_call` extension hooks hold nothing
 * but the call site. Both kinds of gate live on the same table:
 *
 *   • `runPermissionGate()` / `resolvePermission()` — a dangerous command or a
 *     costly index build asking for a nod.
 *   • `requestUserInput()` / `resolveUserInput()` — a batch of structured
 *     questions waiting for answers.
 *
 * Each adapter keeps its own typed name, decision vocabulary and wire event;
 * the table beneath them is payload-generic. See
 * docs/adr/0008-interaction-gates-are-one-module.md for the shape, and
 * docs/adr/0001-subagent-toolsets-must-not-need-a-permission-prompt.md for the
 * subagent rule.
 *
 * Four boundaries this module deliberately keeps:
 *   • It does not know pi's extension return shape: `runPermissionGate()`
 *     hands back a plain `GateOutcome` (`allow`, or `deny` + one sentence),
 *     and the call site wraps that into `{ block: true, reason }`.
 *   • It does not read configuration: the deadline arrives per gate as
 *     `timeoutMs: number | null`, and `null` means no deadline is armed at
 *     all — there is no "only permissions can expire" branch left.
 *   • It does not assert the "at most one gate per session" invariant. One
 *     table keyed by tool call id makes "two gates cannot fit" structural, and
 *     the assumption behind it — pi runs serial preflight before parallel
 *     execution, and `ask_user_questions` declares `executionMode:
 *     "sequential"` — is borrowed. If the SDK ever parallelises them we want
 *     two gates on their two client surfaces, not a crash.
 *   • It does not import the pi SDK: its types come from
 *     `lib/shared/ask-user-questions-tool-types.ts`, so its tests need no SDK.
 */

import type { SessionEvent } from "../shared/session-events";
import type {
  AskUserQuestion,
  AskUserQuestionsCancel,
  AskUserQuestionsDecision,
  UserInputResolution,
} from "../shared/ask-user-questions-tool-types";
import { createLogger } from "./logger";

const log = createLogger("interaction-gates");

/** The user's answer to a permission gate — the wire vocabulary the client
 *  posts back. Unchanged by this move. */
export type PermissionDecision = "allow_once" | "allow_similar" | "deny";

/** What a call site asks for: the tool call that is waiting and how to name it. */
export interface PermissionGateRequest {
  /** The waiting tool call. One gate per id. */
  toolCallId: string;
  /** Session-memo key: the identity "总是允许" grants, and the rule name the
   *  confirmation dialog shows. */
  rule: string;
  /** The command shown verbatim in the confirmation dialog. */
  command: string;
  /** Phrase naming what needs confirming, used in the subagent refusal:
   *  `Blocked: <what> requires the user's confirmation…` (ADR-0001). */
  what: string;
  /** Noun phrase appended to the user's denial — `Denied by user: <x>`.
   *  Omitted → the bare `Denied by user`. */
  deniedSubject?: string;
  /** Deadline for the user's answer, read from config by the call site.
   *  `null` means no deadline is armed at all. */
  timeoutMs: number | null;
}

/** What the question adapter asks for: the waiting tool call, the batch of
 *  questions it is blocked on, and how long the user has to answer. */
export interface UserInputGateRequest {
  /** The waiting tool call. One gate per id. */
  toolCallId: string;
  /** The questions shown on the card, handed back verbatim. */
  questions: AskUserQuestion[];
  /** Deadline for the user's answer. Today's call site always passes `null` —
   *  a question deadline is its own change (see ADR-0008 / #66). */
  timeoutMs: number | null;
}

/**
 * What the caller acts on: the decision, plus the one sentence to hand the
 * agent when it is a refusal. Never pi's `{ block, reason }` shape — wrapping
 * that is the call site's job (ADR-0008).
 */
export type GateOutcome =
  | { decision: "allow" }
  | { decision: "deny"; reason: string };

export interface InteractionGatesOptions {
  /** Where this session's activity comes from. Only `"subagent"` is special:
   *  a child session has no UI to answer a prompt, so its gates refuse
   *  outright (ADR-0001). The other values are carried through untouched. */
  source: string;
  /** How synthesized events reach the session's listeners. */
  emit: (event: SessionEvent) => void;
}

/** The two adapters sharing the table (ADR-0008). */
type GateKind = "permission" | "user_input";

/**
 * One row per waiting tool call. The decision vocabulary belongs to the
 * adapter that opened the gate, so the row is decision-agnostic — it carries
 * the wait, its `kind` (which adapter owns the id), and the two typed
 * resolvers narrow the decision back on the way out. Everything here beyond
 * `event` is internal by construction: `snapshot()` hands out the event and
 * nothing else.
 */
interface PendingGate {
  /** Which adapter opened this row. The table is shared, but a decision of one
   *  kind must never settle a wait of the other. */
  kind: GateKind;
  /** Shared by every waiter for this tool call id, so a duplicate open cannot
   *  strand the first caller. `unknown` because the row does not own the
   *  vocabulary; `openGate<Decision>()` returns it typed. */
  promise: Promise<unknown>;
  /** Settle the wait with the adapter's decision. The caller of this face is
   *  always the resolver that belongs to the same adapter as the opener. */
  settle(decision: unknown): void;
  /** Fail the wait — the session went away under it. */
  reject(reason: string): void;
  /** The memo key that `allow_similar` grants for this gate; `null` for gates
   *  that have no memo (questions). */
  memoKey: string | null;
  /** The line-protocol event that put this gate on the user's screen, kept so
   *  a reconnecting client gets the same shape back. */
  event: SessionEvent;
  /** `null` when the gate was opened without a deadline. */
  deadline: ReturnType<typeof setTimeout> | null;
}

/** How a gate is opened on the shared table (the generic core of both
 *  adapters). */
interface OpenGateParams<Decision> {
  kind: GateKind;
  toolCallId: string;
  /** The wire event for this gate — what goes out now and what `snapshot()`
   *  replays later. */
  event: SessionEvent;
  /** Session-memo key an `allow_similar` grants; `null` when the gate has no
   *  memo. */
  memoKey: string | null;
  /** The deadline this gate arms, if any: after how long, and what a lapse
   *  settles with (the adapter's own "nobody answered" decision). `null` arms
   *  no timer at all, so the table has no "only this kind expires" branch. */
  deadline: { timeoutMs: number; lapse: Decision } | null;
}

export class InteractionGates {
  private readonly pending = new Map<string, PendingGate>();
  private readonly allowedRules = new Set<string>();

  constructor(private readonly options: InteractionGatesOptions) {}

  /**
   * The whole gate sequence a call site needs, in one call: session memo →
   * subagent refusal → ask the user → interpret the answer.
   */
  async runPermissionGate(request: PermissionGateRequest): Promise<GateOutcome> {
    if (this.allowedRules.has(request.rule)) return { decision: "allow" };
    if (this.options.source === "subagent") {
      return { decision: "deny", reason: subagentRefusal(request.what) };
    }
    const decision = await this.openGate<PermissionDecision>({
      kind: "permission",
      toolCallId: request.toolCallId,
      event: {
        type: "permission_request",
        toolCallId: request.toolCallId,
        ruleName: request.rule,
        command: request.command,
      },
      memoKey: request.rule,
      deadline:
        request.timeoutMs === null
          ? null
          : { timeoutMs: request.timeoutMs, lapse: "deny" },
    });
    if (decision !== "deny") return { decision: "allow" };
    return { decision: "deny", reason: denialReason(request) };
  }

  /**
   * The decision the client posted back. Returns false (never throws) when no
   * such gate is open — a duplicate or stale decision is not an error.
   */
  resolvePermission(toolCallId: string, decision: PermissionDecision): boolean {
    const gate = this.takeGate(toolCallId, "permission");
    if (!gate) return false;
    // "总是允许" is recorded before the waiter resumes, so the next call for
    // this rule already sees it.
    if (decision === "allow_similar" && gate.memoKey) this.allowedRules.add(gate.memoKey);
    gate.settle(decision);
    log.info("permission resolved", { toolCallId, decision });
    return true;
  }

  /**
   * Block the question tool until the user answers the batch or cancels.
   * Emits the `ask_user_questions_request` wire event and resolves with the
   * user's answers, or `{kind: "cancelled"}` when they clicked Cancel.
   */
  requestUserInput(request: UserInputGateRequest): Promise<UserInputResolution> {
    return this.openGate<UserInputResolution>({
      kind: "user_input",
      toolCallId: request.toolCallId,
      event: {
        type: "ask_user_questions_request",
        toolCallId: request.toolCallId,
        questions: request.questions,
        ts: Date.now(),
      },
      memoKey: null,
      // Questions have no deadline today (`timeoutMs` is null), so this lapse
      // is never reached. It stays the adapter's own vocabulary on purpose:
      // if a question deadline is ever wired up (#66 keeps that out of scope),
      // an unanswered card reads as the same unblocking outcome as a cancel
      // rather than inventing a third resolution.
      deadline:
        request.timeoutMs === null
          ? null
          : { timeoutMs: request.timeoutMs, lapse: { kind: "cancelled" } },
    });
  }

  /**
   * Settle a pending question gate with what the client posted back: the
   * answers, or a cancel. Returns false (never throws) when no such gate is
   * open.
   */
  resolveUserInput(
    toolCallId: string,
    decision: AskUserQuestionsDecision | AskUserQuestionsCancel,
  ): boolean {
    const gate = this.takeGate(toolCallId, "user_input");
    if (!gate) return false;
    if ("cancelled" in decision && decision.cancelled) {
      gate.settle({ kind: "cancelled" });
      log.info("ask_user_questions cancelled", { toolCallId });
    } else if ("answers" in decision) {
      gate.settle({ kind: "answered", answers: decision.answers });
      log.info("ask_user_questions answered", {
        toolCallId,
        answerCount: decision.answers.filter((a) => a.selectedLabels.length > 0).length,
      });
    } else {
      // Defensive: unknown decision shape — treat as cancel to unblock.
      gate.settle({ kind: "cancelled" });
      log.warn("ask_user_questions unknown decision shape, treated as cancel", {
        toolCallId,
      });
    }
    return true;
  }

  /**
   * The line-protocol events of every gate still waiting, in the order they
   * were opened — the answer to "what must a reconnecting client be told?".
   * Only wire shapes leave here; the table's promise, memo key and timer stay
   * inside.
   */
  snapshot(): SessionEvent[] {
    return [...this.pending.values()].map((gate) => ({ ...gate.event }));
  }

  /**
   * Invalidate every open gate and forget the session memo. The wrapper calls
   * this exactly once, from `destroy()`.
   */
  invalidateAll(): void {
    for (const gate of this.pending.values()) {
      if (gate.deadline) clearTimeout(gate.deadline);
      gate.reject("destroyed");
    }
    this.pending.clear();
    this.allowedRules.clear();
  }

  /** Open a gate on the shared table and wait for its decision. */
  private openGate<Decision>(params: OpenGateParams<Decision>): Promise<Decision> {
    const existing = this.pending.get(params.toolCallId);
    // A duplicate open shares the first wait: one row, every waiter settles
    // together. The id belongs to a single adapter, so the row's decision type
    // is the caller's.
    if (existing) return existing.promise as Promise<Decision>;

    let resolveWait!: (decision: Decision) => void;
    let rejectWait!: (reason: string) => void;
    const promise = new Promise<Decision>((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
    });
    const gate: PendingGate = {
      kind: params.kind,
      promise,
      settle: (decision) => resolveWait(decision as Decision),
      reject: rejectWait,
      memoKey: params.memoKey,
      event: params.event,
      deadline: null,
    };
    this.pending.set(params.toolCallId, gate);

    if (params.deadline) {
      const { timeoutMs, lapse } = params.deadline;
      gate.deadline = setTimeout(() => {
        // Already answered: the resolver cleared the row first.
        if (!this.pending.delete(params.toolCallId)) return;
        log.warn("gate timed out, settling with its deadline decision", {
          toolCallId: params.toolCallId,
          kind: params.kind,
          timeoutMs,
        });
        resolveWait(lapse);
      }, timeoutMs);
    }

    this.options.emit(gate.event);
    log.info("gate opened", {
      toolCallId: params.toolCallId,
      kind: params.kind,
      event: params.event.type,
      timeoutMs: params.deadline?.timeoutMs ?? null,
    });
    return promise;
  }

  /**
   * Take a waiting gate off the table and stop its timer. `null` when no such
   * gate is open *or* when the id belongs to the other adapter — a stale or
   * mixed-up decision resolves nothing, exactly as the two per-adapter tables
   * used to behave.
   */
  private takeGate(toolCallId: string, kind: GateKind): PendingGate | null {
    const gate = this.pending.get(toolCallId);
    if (!gate || gate.kind !== kind) return null;
    this.pending.delete(toolCallId);
    if (gate.deadline) clearTimeout(gate.deadline);
    return gate;
  }
}

/** A subagent has no UI attached, so waiting for a timeout only burns minutes
 *  to reach an outcome we already know (ADR-0001). */
function subagentRefusal(what: string): string {
  return `Blocked: ${what} requires the user's confirmation, which is unavailable inside a subagent session. Don't retry it; use a read-only alternative and tell the user what you need.`;
}

function denialReason(request: PermissionGateRequest): string {
  return request.deniedSubject
    ? `Denied by user: ${request.deniedSubject}`
    : "Denied by user";
}
