// ============================================================================
// Auto-naming rules (pure)
//
// "Should this session be auto-named right now, and may the LLM's answer be
// written back?" — the whole decision, with no React, DOM, timers or network.
// The client hook (`components/chat/chat-window/hooks/useAutoNaming.ts`) owns
// the 1s timer, the two requests, the toasts and the shell reporting; it asks
// these two functions what to do at each step.
//
// Two modes:
//   - "manual"  — the user clicked the Auto-name button. It prompts before
//                 overwriting an existing name, and it refuses to run while the
//                 agent is busy.
//   - "auto"    — the silent 1s-after-first-assistant trigger. It never
//                 prompts and may piggyback on the in-flight first turn, but it
//                 yields to any name the user set (before the call, or while
//                 the LLM was answering).
//
// The two race rules are:
//   1. A rename that lands in the 1s window before the LLM call wins — the
//      trigger decision abandons before a request is ever sent.
//   2. A rename that lands while the LLM is answering wins — the apply decision
//      abandons silently when the answer comes back.
// ============================================================================

export type AutoNameMode = "manual" | "auto";

/** Why an auto-name trigger was refused, or an LLM answer was discarded. */
export type AutoNameAbandonReason =
  | "no-session"
  | "already-running"
  | "agent-running"
  | "no-first-user-message"
  | "name-already-set"
  | "empty-name";

export interface AutoNameStartInput {
  mode: AutoNameMode;
  /** The session being named (`session?.id`). Null on the new-session page. */
  sessionId: string | null | undefined;
  /** An auto-name request is already in flight for this window. */
  isAutoNaming: boolean;
  /** The agent is streaming or running a turn. */
  agentRunning: boolean;
  /** Text of the session's first user message (null when there is none yet). */
  firstUserMessageText: string | null | undefined;
  /**
   * The session's name as of now. Used by the auto mode's pre-flight race rule;
   * for manual mode a non-empty name is a prompt, not an abandonment.
   */
  currentSessionName: string | null | undefined;
}

export type AutoNameStartDecision =
  /** Proceed, against the one session the decision validated. */
  | { kind: "proceed"; sessionId: string }
  | { kind: "abandon"; reason: AutoNameAbandonReason };

/**
 * May an auto-name request start? Checked in a fixed order so the reason is
 * deterministic when several conditions hold at once.
 */
export function decideAutoNameStart(input: AutoNameStartInput): AutoNameStartDecision {
  if (!input.sessionId) return { kind: "abandon", reason: "no-session" };
  if (input.isAutoNaming) return { kind: "abandon", reason: "already-running" };
  // Manual naming is a user action against a settled session; auto naming is
  // allowed to ride along with the live first turn.
  if (input.mode === "manual" && input.agentRunning) {
    return { kind: "abandon", reason: "agent-running" };
  }
  if (!input.firstUserMessageText || !input.firstUserMessageText.trim()) {
    return { kind: "abandon", reason: "no-first-user-message" };
  }
  // Race rule 1 (auto only): a rename inside the 1s window already won.
  if (input.mode === "auto" && input.currentSessionName && input.currentSessionName.trim()) {
    return { kind: "abandon", reason: "name-already-set" };
  }
  return { kind: "proceed", sessionId: input.sessionId };
}

export interface AutoNamePromptInput {
  mode: AutoNameMode;
  /** The session's name as of now. */
  currentSessionName: string | null | undefined;
}

/**
 * Manual naming overwrites a user-chosen name, so it must ask first; the silent
 * auto mode never prompts. Manual naming over a session with no name applies
 * straight away.
 */
export function shouldConfirmAutoName(input: AutoNamePromptInput): boolean {
  if (input.mode !== "manual") return false;
  return Boolean(input.currentSessionName && input.currentSessionName.trim());
}

export interface AutoNameApplyInput {
  mode: AutoNameMode;
  /** The name returned by the auto-name API; may be empty or whitespace. */
  suggestedName: string | null | undefined;
  /** The session's name as of now — read fresh, after the LLM call returned. */
  currentSessionName: string | null | undefined;
}

export type AutoNameApplyDecision =
  | { kind: "apply"; name: string }
  | { kind: "abandon"; reason: AutoNameAbandonReason };

/**
 * Should the LLM's suggested name be written back? The trimmed name is
 * returned so the caller can PATCH it without re-trimming.
 */
export function decideAutoNameApply(input: AutoNameApplyInput): AutoNameApplyDecision {
  const name = input.suggestedName?.trim();
  if (!name) return { kind: "abandon", reason: "empty-name" };
  // Race rule 2 (auto only): a rename during the LLM call already won.
  if (input.mode === "auto" && input.currentSessionName && input.currentSessionName.trim()) {
    return { kind: "abandon", reason: "name-already-set" };
  }
  return { kind: "apply", name };
}
