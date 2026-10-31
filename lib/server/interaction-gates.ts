import type { SessionEvent } from "../shared/session-events";
import {
  ASK_USER_QUESTIONS_REPLY_MAX,
  type AskUserQuestion,
  type AskUserQuestionsCancel,
  type AskUserQuestionsDecision,
  type UserInputResolution,
} from "../shared/ask-user-questions-tool-types";
import {
  DEFAULT_PERMISSION_MODE,
  type SessionPermissionMode,
} from "../shared/permission-mode";
import { createLogger } from "./logger";

const log = createLogger("interaction-gates");

export type PermissionDecision = "allow_once" | "allow_similar" | "deny";

export interface PermissionGateRequest {
  toolCallId: string;
  rule: string;
  command: string;
  what: string;
  deniedSubject?: string;
  timeoutMs: number | null;
}

export interface UserInputGateRequest {
  toolCallId: string;
  questions: AskUserQuestion[];
  timeoutMs: number | null;
}

export type GateOutcome =
  | { decision: "allow" }
  | { decision: "deny"; reason: string };

export interface InteractionGatesOptions {
  emit: (event: SessionEvent) => void;
  permissionMode?: () => SessionPermissionMode;
}

type GateKind = "permission" | "user_input";

interface PendingGate {
  kind: GateKind;
  promise: Promise<unknown>;
  settle(decision: unknown): void;
  reject(reason: string): void;
  memoKey: string | null;
  event: SessionEvent;
  deadline: ReturnType<typeof setTimeout> | null;
}

interface OpenGateParams<Decision> {
  kind: GateKind;
  toolCallId: string;
  event: SessionEvent;
  memoKey: string | null;
  deadline: { timeoutMs: number; lapse: Decision } | null;
}

export class InteractionGates {
  private readonly pending = new Map<string, PendingGate>();
  private readonly allowedRules = new Set<string>();

  constructor(private readonly options: InteractionGatesOptions) {}

  async runPermissionGate(request: PermissionGateRequest): Promise<GateOutcome> {
    const mode = this.options.permissionMode?.() ?? DEFAULT_PERMISSION_MODE;
    if (mode === "auto_deny") {
      return { decision: "deny", reason: autoDenyReason(request.what) };
    }
    if (this.allowedRules.has(request.rule)) return { decision: "allow" };
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

  resolvePermission(toolCallId: string, decision: PermissionDecision): boolean {
    const gate = this.takeGate(toolCallId, "permission");
    if (!gate) return false;
    if (decision === "allow_similar" && gate.memoKey) this.allowedRules.add(gate.memoKey);
    gate.settle(decision);
    log.info("permission resolved", { toolCallId, decision });
    return true;
  }

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
      deadline:
        request.timeoutMs === null
          ? null
          : { timeoutMs: request.timeoutMs, lapse: { kind: "cancelled" } },
    });
  }

  resolveUserInput(
    toolCallId: string,
    decision: AskUserQuestionsDecision | AskUserQuestionsCancel,
  ): boolean {
    const gate = this.takeGate(toolCallId, "user_input");
    if (!gate) return false;
    if ("cancelled" in decision && decision.cancelled) {
      const message = (decision.message ?? "")
        .trim()
        .slice(0, ASK_USER_QUESTIONS_REPLY_MAX);
      if (message.length > 0) {
        gate.settle({ kind: "replied", message });
        log.info("ask_user_questions cancelled with a note", { toolCallId });
      } else {
        gate.settle({ kind: "cancelled" });
        log.info("ask_user_questions cancelled", { toolCallId });
      }
    } else if ("answers" in decision) {
      gate.settle({ kind: "answered", answers: decision.answers });
      log.info("ask_user_questions answered", {
        toolCallId,
        answerCount: decision.answers.filter((a) => a.selectedLabels.length > 0).length,
      });
    } else {
      gate.settle({ kind: "cancelled" });
      log.warn("ask_user_questions unknown decision shape, treated as cancel", {
        toolCallId,
      });
    }
    return true;
  }

  snapshot(): SessionEvent[] {
    return [...this.pending.values()].map((gate) => ({ ...gate.event }));
  }

  invalidateAll(): void {
    for (const gate of this.pending.values()) {
      if (gate.deadline) clearTimeout(gate.deadline);
      gate.reject("destroyed");
    }
    this.pending.clear();
    this.allowedRules.clear();
  }

  clearSessionMemo(): void {
    if (this.allowedRules.size === 0) return;
    this.allowedRules.clear();
    log.info("session permission memo cleared");
  }

  private openGate<Decision>(params: OpenGateParams<Decision>): Promise<Decision> {
    const existing = this.pending.get(params.toolCallId);
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

  private takeGate(toolCallId: string, kind: GateKind): PendingGate | null {
    const gate = this.pending.get(toolCallId);
    if (!gate || gate.kind !== kind) return null;
    this.pending.delete(toolCallId);
    if (gate.deadline) clearTimeout(gate.deadline);
    return gate;
  }
}

function autoDenyReason(what: string): string {
  return `Blocked: ${what} matches a dangerous-command rule, and this unattended session is configured to auto-deny dangerous commands. Don't retry it; use a safe alternative if one exists, or stop and tell the user the exact command to run manually.`;
}

function denialReason(request: PermissionGateRequest): string {
  return request.deniedSubject
    ? `Denied by user: ${request.deniedSubject}`
    : "Denied by user";
}
