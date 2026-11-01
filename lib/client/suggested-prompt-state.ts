import { decideSuggestedPromptTab } from "@/lib/shared/suggested-prompt";

export interface SuggestedPromptLeafText {
  leafId: string;
  text: string;
}

export type SuggestedPromptFetchDecision =
  | { kind: "fetch"; sessionId: string; leafId: string }
  | { kind: "skip"; reason: "no-session" | "no-leaf" | "turn-running" };

export function decideSuggestedPromptFetch(input: {
  sessionId: string | null;
  leafId: string | null;
  busy: boolean;
}): SuggestedPromptFetchDecision {
  if (!input.sessionId) return { kind: "skip", reason: "no-session" };
  if (!input.leafId) return { kind: "skip", reason: "no-leaf" };
  if (input.busy) return { kind: "skip", reason: "turn-running" };
  return { kind: "fetch", sessionId: input.sessionId, leafId: input.leafId };
}

export interface SuggestedPromptSelectionInput {
  leafId: string | null;
  fetched: SuggestedPromptLeafText | null;
  pushed: SuggestedPromptLeafText | null;
  suppressedLeafId: string | null;
}

export function selectSuggestionText(input: SuggestedPromptSelectionInput): string | null {
  const { leafId } = input;
  if (!leafId) return null;
  if (input.suppressedLeafId === leafId) return null;
  if (input.pushed?.leafId === leafId) return input.pushed.text.trim() || null;
  if (input.fetched?.leafId === leafId) return input.fetched.text.trim() || null;
  return null;
}

export interface SuggestedPromptPlaceholderInput {
  inputText: string;
  suggestion: string | null;
  fallback: string;
}

export function selectSuggestedPromptPlaceholder(input: SuggestedPromptPlaceholderInput): string {
  const decision = decideSuggestedPromptTab({
    inputText: input.inputText,
    suggestion: input.suggestion,
  });
  return decision.kind === "adopt" ? decision.text : input.fallback;
}
