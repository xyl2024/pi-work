/**
 * Interaction gates — the one place a tool call stops and waits for the user.
 *
 * A gate is opened, decided, and torn down through this interface; the session
 * wrapper owns one instance and the `tool_call` extension hooks hold nothing
 * but the call site. See
 * docs/adr/0008-interaction-gates-are-one-module.md for the shape, and
 * docs/adr/0001-subagent-toolsets-must-not-need-a-permission-prompt.md for the
 * subagent rule.
 *
 * Three boundaries this module deliberately keeps:
 *   • It does not know pi's extension return shape: `runPermissionGate()`
 *     hands back a plain `GateOutcome` (`allow`, or `deny` + one sentence),
 *     and the call site wraps that into `{ block: true, reason }`.
 *   • It does not read configuration: the deadline arrives as
 *     `timeoutMs: number | null`.
 *   • It does not assert the "at most one gate per session" invariant. One
 *     table per tool call id makes "two gates cannot fit" structural, and the
 *     assumption behind it — pi runs serial preflight before parallel
 *     execution, and `ask_user_questions` declares `executionMode:
 *     "sequential"` — is borrowed. If the SDK ever parallelises them we want
 *     two gates on their two client surfaces, not a crash.
 */

import type { SessionEvent } from "../shared/session-events";
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

interface PendingGate {
  /** Shared by every waiter for this tool call id, so a duplicate open cannot
   *  strand the first caller. */
  promise: Promise<PermissionDecision>;
  settle: (decision: PermissionDecision) => void;
  reject: (reason: string) => void;
  /** The memo key that `allow_similar` grants for this gate. */
  rule: string;
  /** `null` when the gate was opened without a deadline. */
  deadline: ReturnType<typeof setTimeout> | null;
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
    const decision = await this.openPermissionGate(request);
    if (decision !== "deny") return { decision: "allow" };
    return { decision: "deny", reason: denialReason(request) };
  }

  /**
   * The decision the client posted back. Returns false (never throws) when no
   * such gate is open — a duplicate or stale decision is not an error.
   */
  resolvePermission(toolCallId: string, decision: PermissionDecision): boolean {
    const gate = this.pending.get(toolCallId);
    if (!gate) return false;
    this.pending.delete(toolCallId);
    if (gate.deadline) clearTimeout(gate.deadline);
    // "总是允许" is recorded before the waiter resumes, so the next call for
    // this rule already sees it.
    if (decision === "allow_similar") this.allowedRules.add(gate.rule);
    gate.settle(decision);
    log.info("permission resolved", { toolCallId, decision });
    return true;
  }

  /**
   * Invalidate every open gate and forget the session memo. The wrapper calls
   * this exactly once, from `destroy()`.
   */
  invalidateAll(): void {
    for (const [, gate] of this.pending) {
      if (gate.deadline) clearTimeout(gate.deadline);
      gate.reject("destroyed");
    }
    this.pending.clear();
    this.allowedRules.clear();
  }

  /** Open the gate for a tool call and wait for its decision. */
  private openPermissionGate(request: PermissionGateRequest): Promise<PermissionDecision> {
    const existing = this.pending.get(request.toolCallId);
    if (existing) return existing.promise;

    let settle!: (decision: PermissionDecision) => void;
    let reject!: (reason: string) => void;
    const promise = new Promise<PermissionDecision>((res, rej) => {
      settle = res;
      reject = rej;
    });
    const gate: PendingGate = {
      promise,
      settle,
      reject,
      rule: request.rule,
      deadline: null,
    };
    this.pending.set(request.toolCallId, gate);

    if (request.timeoutMs !== null) {
      gate.deadline = setTimeout(() => {
        // Already answered: resolvePermission cleared the entry first.
        if (!this.pending.delete(request.toolCallId)) return;
        log.warn("permission request timed out, auto-denying", {
          toolCallId: request.toolCallId,
          ruleName: request.rule,
        });
        settle("deny");
      }, request.timeoutMs);
    }

    this.options.emit({
      type: "permission_request",
      toolCallId: request.toolCallId,
      ruleName: request.rule,
      command: request.command,
    });
    log.info("permission requested", {
      toolCallId: request.toolCallId,
      ruleName: request.rule,
    });
    return promise;
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
