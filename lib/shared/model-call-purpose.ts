/**
 * Pure classification of the SDK's internal summarization requests.
 *
 * Compaction and branch summaries are issued by pi's own agent session, not by
 * a Pi Work command, so the only signal available at the ModelRuntime boundary
 * is the request itself. pi 1.2.0 routes every compaction/branch-summary LLM
 * call through `completeSummarization`, which uses SUMMARIZATION_SYSTEM_PROMPT
 * from `core/compaction/utils.ts`. That constant is not part of the package's
 * public exports, so this rule tracks its stable opening sentence instead.
 *
 * If pi ever changes that prompt, affected calls still get recorded; they just
 * fall back to the enclosing purpose (`chat`) instead of being dropped or
 * misattributed to another source.
 *
 * Kept free of Node, SQLite and SDK imports so the request-shape rule can be
 * tested without building a model runtime.
 */

import type { CallPurpose } from "./token-audit-types";

const SUMMARIZATION_SYSTEM_PROMPT_PREFIX = "You are a context summarization assistant.";

// Branch summaries reuse the same system prompt as compaction, but their
// instructions (BRANCH_SUMMARY_PROMPT) are unique. The marker is checked only
// after the serialized conversation's closing tag, so a conversation that
// merely *mentions* the phrase cannot turn a compaction into a branch summary.
// `navigateTree({ replaceInstructions: true })` can replace the default
// instructions entirely; Pi Work does not expose that option, so such a call
// falls back to `compaction` instead of being dropped.
const BRANCH_SUMMARY_INSTRUCTION_MARKER =
  "Create a structured summary of this conversation branch";
const CONVERSATION_CLOSE_TAG = "</conversation>";

function messageText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    const text = (block as { type?: unknown; text?: unknown } | null)?.text;
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("");
}

/**
 * System prompt as seen at the ModelRuntime boundary. The agent loop and
 * `completeSummarization` hand over a normalized transcript, so the prompt is
 * the leading system message; raw callers may still pass `systemPrompt`.
 */
function requestSystemPrompt(context: unknown): string | null {
  const request = context as
    | { systemPrompt?: unknown; messages?: unknown }
    | null
    | undefined;
  if (typeof request?.systemPrompt === "string") return request.systemPrompt;
  const messages = request?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const first = messages[0] as { role?: unknown; content?: unknown } | null | undefined;
  if (first?.role !== "system") return null;
  return messageText(first.content);
}

function lastUserMessageText(context: unknown): string | null {
  const messages = (context as { messages?: unknown } | null | undefined)?.messages;
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: unknown; content?: unknown } | null | undefined;
    if (message?.role === "user") return messageText(message.content);
  }
  return null;
}

/** Instructions appended after the serialized conversation (or the whole prompt). */
function instructionsAfterConversation(text: string): string {
  const close = text.lastIndexOf(CONVERSATION_CLOSE_TAG);
  const instructions = close >= 0 ? text.slice(close + CONVERSATION_CLOSE_TAG.length) : text;
  return instructions.trimStart();
}

/**
 * Purpose for an SDK summarization call, or null for ordinary chat/direct calls.
 */
export function summarizationPurpose(context: unknown): CallPurpose | null {
  const systemPrompt = requestSystemPrompt(context);
  if (!systemPrompt?.startsWith(SUMMARIZATION_SYSTEM_PROMPT_PREFIX)) return null;
  const instructions = instructionsAfterConversation(lastUserMessageText(context) ?? "");
  if (instructions.startsWith(BRANCH_SUMMARY_INSTRUCTION_MARKER)) return "branch-summary";
  return "compaction";
}
