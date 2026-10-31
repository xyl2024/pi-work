import { extractMessageText } from "./message-content";
import type { AssistantMessage, SessionEntry, SessionMessageEntry } from "./types";

export type SuggestedPromptAbandonReason = "subagent-session" | "scheduled-session";

export interface SuggestedPromptEligibilityInput {
  isSubagentChildSession: boolean;
  isScheduledSession: boolean;
}

export type SuggestedPromptEligibilityDecision =
  | { kind: "proceed" }
  | { kind: "abandon"; reason: SuggestedPromptAbandonReason };

export function decideSuggestedPromptEligibility(
  input: SuggestedPromptEligibilityInput,
): SuggestedPromptEligibilityDecision {
  if (input.isSubagentChildSession) return { kind: "abandon", reason: "subagent-session" };
  if (input.isScheduledSession) return { kind: "abandon", reason: "scheduled-session" };
  return { kind: "proceed" };
}

export interface SuggestedPromptTabInput {
  inputText: string;
  suggestion: string | null | undefined;
}

export type SuggestedPromptTabDecision =
  | { kind: "adopt"; text: string }
  | { kind: "none" };

export function decideSuggestedPromptTab(input: SuggestedPromptTabInput): SuggestedPromptTabDecision {
  if (input.inputText.trim()) return { kind: "none" };
  const suggestion = input.suggestion?.trim();
  if (!suggestion) return { kind: "none" };
  return { kind: "adopt", text: suggestion };
}

export const MAX_SUGGESTION_CHARS = 150;

export type SuggestionCleanupReason = "empty-suggestion" | "suggestion-too-long";

export type SuggestionCleanupDecision =
  | { kind: "use"; suggestion: string }
  | { kind: "abandon"; reason: SuggestionCleanupReason };

const LEADING_MARKUP = /^[\s"'‘’“”「『`《\[#*\-–—>]+/;
const TRAILING_MARKUP = /[\s"'‘’“”」』`》\]*_\];,.]+$/;

export function cleanSuggestion(raw: string | null | undefined): SuggestionCleanupDecision {
  const collapsed = raw?.replace(/\s+/g, " ").trim() ?? "";
  const suggestion = collapsed.replace(LEADING_MARKUP, "").replace(TRAILING_MARKUP, "").trim();
  if (!suggestion) return { kind: "abandon", reason: "empty-suggestion" };
  if (Array.from(suggestion).length > MAX_SUGGESTION_CHARS) {
    return { kind: "abandon", reason: "suggestion-too-long" };
  }
  return { kind: "use", suggestion };
}

export function resolveActivePath(
  entries: readonly SessionEntry[],
  leafId: string | null | undefined,
): SessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let cursor = leafId ? leafId : entries.at(-1)?.id;
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const entry = byId.get(cursor);
    if (!entry) break;
    path.push(entry);
    cursor = entry.parentId ?? undefined;
  }
  return path.reverse();
}

export type NormalEndAbandonReason =
  | "no-assistant-message"
  | "turn-not-complete"
  | "empty-assistant-text";

export type NormalEndDecision =
  | { kind: "proceed" }
  | { kind: "abandon"; reason: NormalEndAbandonReason };

function isAssistantMessageEntry(
  entry: SessionEntry,
): entry is SessionMessageEntry & { message: AssistantMessage } {
  return entry.type === "message" && entry.message.role === "assistant";
}

export function decideNormalEnd(path: readonly SessionEntry[]): NormalEndDecision {
  const message = path.findLast(isAssistantMessageEntry)?.message;
  if (!message) return { kind: "abandon", reason: "no-assistant-message" };
  if (message.stopReason !== "stop") return { kind: "abandon", reason: "turn-not-complete" };
  if (!extractMessageText(message).trim()) {
    return { kind: "abandon", reason: "empty-assistant-text" };
  }
  return { kind: "proceed" };
}

export interface SuggestedPromptContextEntry {
  role: "user" | "assistant";
  text: string;
}

export function extractSuggestedPromptContext(
  path: readonly SessionEntry[],
): SuggestedPromptContextEntry[] {
  const context: SuggestedPromptContextEntry[] = [];
  for (const entry of path) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "assistant" && message.stopReason !== "stop") continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = extractMessageText(message).trim();
    if (!text) continue;
    context.push({ role: message.role, text });
  }
  return context;
}
