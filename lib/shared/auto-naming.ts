export type AutoNameMode = "manual" | "auto";

export type AutoNameAbandonReason =
  | "no-session"
  | "already-running"
  | "agent-running"
  | "no-first-user-message"
  | "name-already-set"
  | "empty-name";

export interface AutoNameStartInput {
  mode: AutoNameMode;
  sessionId: string | null | undefined;
  isAutoNaming: boolean;
  agentRunning: boolean;
  firstUserMessageText: string | null | undefined;
  currentSessionName: string | null | undefined;
}

export type AutoNameStartDecision =
  | { kind: "proceed"; sessionId: string }
  | { kind: "abandon"; reason: AutoNameAbandonReason };

export function decideAutoNameStart(input: AutoNameStartInput): AutoNameStartDecision {
  if (!input.sessionId) return { kind: "abandon", reason: "no-session" };
  if (input.isAutoNaming) return { kind: "abandon", reason: "already-running" };
  if (input.mode === "manual" && input.agentRunning) {
    return { kind: "abandon", reason: "agent-running" };
  }
  if (!input.firstUserMessageText || !input.firstUserMessageText.trim()) {
    return { kind: "abandon", reason: "no-first-user-message" };
  }
  if (input.mode === "auto" && input.currentSessionName && input.currentSessionName.trim()) {
    return { kind: "abandon", reason: "name-already-set" };
  }
  return { kind: "proceed", sessionId: input.sessionId };
}

export interface AutoNamePromptInput {
  mode: AutoNameMode;
  currentSessionName: string | null | undefined;
}

export function shouldConfirmAutoName(input: AutoNamePromptInput): boolean {
  if (input.mode !== "manual") return false;
  return Boolean(input.currentSessionName && input.currentSessionName.trim());
}

export interface AutoNameApplyInput {
  mode: AutoNameMode;
  suggestedName: string | null | undefined;
  currentSessionName: string | null | undefined;
}

export type AutoNameApplyDecision =
  | { kind: "apply"; name: string }
  | { kind: "abandon"; reason: AutoNameAbandonReason };

export function decideAutoNameApply(input: AutoNameApplyInput): AutoNameApplyDecision {
  const name = input.suggestedName?.trim();
  if (!name) return { kind: "abandon", reason: "empty-name" };
  if (input.mode === "auto" && input.currentSessionName && input.currentSessionName.trim()) {
    return { kind: "abandon", reason: "name-already-set" };
  }
  return { kind: "apply", name };
}
