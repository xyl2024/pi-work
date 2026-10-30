import type { CallPurpose } from "./token-audit-types";

const SUMMARIZATION_SYSTEM_PROMPT_PREFIX = "You are a context summarization assistant.";

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

function instructionsAfterConversation(text: string): string {
  const close = text.lastIndexOf(CONVERSATION_CLOSE_TAG);
  const instructions = close >= 0 ? text.slice(close + CONVERSATION_CLOSE_TAG.length) : text;
  return instructions.trimStart();
}

export function summarizationPurpose(context: unknown): CallPurpose | null {
  const systemPrompt = requestSystemPrompt(context);
  if (!systemPrompt?.startsWith(SUMMARIZATION_SYSTEM_PROMPT_PREFIX)) return null;
  const instructions = instructionsAfterConversation(lastUserMessageText(context) ?? "");
  if (instructions.startsWith(BRANCH_SUMMARY_INSTRUCTION_MARKER)) return "branch-summary";
  return "compaction";
}
