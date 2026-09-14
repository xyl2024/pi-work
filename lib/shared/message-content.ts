// ============================================================================
// Message content (pure)
//
// The single source of the content facts a view needs to draw one message:
//
//   - its text (a string, or its text blocks joined);
//   - which images it carries, and how many;
//   - how many thinking / toolCall blocks an assistant message holds;
//   - how many characters its blocks add up to (the streaming tps estimate).
//
// Renamed from its first consumer's name (the conversation-tree "card"):
// "card" named the caller, not the concern. Callers now ask for message
// content instead of re-deriving it from `message.content` themselves.
//
// Like `panelTabs`, `chat-timeline` and `tool-call-display`
// (ADR-0002 / ADR-0003) this module may not import React, i18n, a client
// hook, or anything from `lib/server`.
// ============================================================================

import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  ImageContent,
  TextContent,
} from "./types";

/**
 * Pull the text out of an AgentMessage for display.
 * - User / custom messages: string content as-is, or joined text blocks.
 * - Assistant messages: joined text blocks.
 * - ToolResult: joined text blocks (rarely a card, but defensive).
 *
 * Text blocks are joined with `\n` — the rule the chat views already used.
 * (The conversation-tree card collapses all whitespace when it renders, so
 * the separator is not observable there.)
 *
 * Empty string is meaningful — used to detect "this final assistant had no
 * text" and fall back to the [完成工具调用] / [发送了图片] placeholder.
 */
export function extractMessageText(message: AgentMessage): string {
  if (message.role === "user" || message.role === "custom") {
    const content = message.content;
    if (typeof content === "string") return content;
    return content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  if (message.role === "assistant") {
    return message.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  if (message.role === "toolResult") {
    return message.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

/** The image blocks a message carries, in order. The single definition of
 *  "which content blocks are images" — `countImages` is this length. */
export function extractMessageImages(message: AgentMessage): ImageContent[] {
  if (message.role === "user" || message.role === "custom") {
    const content = message.content;
    if (typeof content === "string") return [];
    return content.filter((block): block is ImageContent => block.type === "image");
  }
  if (message.role === "assistant") {
    return message.content.filter((block): block is ImageContent => block.type === "image");
  }
  if (message.role === "toolResult") {
    return message.content.filter((block): block is ImageContent => block.type === "image");
  }
  return [];
}

/** How many images a message carries. */
export function countImages(message: AgentMessage): number {
  return extractMessageImages(message).length;
}

export interface RoundStats {
  thinking: number;
  toolCalls: number;
}

/**
 * Sum thinking + toolCall content blocks across the assistant messages in a
 * round (the user message and everything below it down to the next user
 * message in that branch). toolResult messages are skipped — they aren't
 * assistant messages.
 */
export function countAssistantBlocks(message: AgentMessage): RoundStats {
  if (message.role !== "assistant") return { thinking: 0, toolCalls: 0 };
  const blocks = (message as AssistantMessage).content;
  let thinking = 0;
  let toolCalls = 0;
  for (const b of blocks) {
    if (b.type === "thinking") thinking++;
    else if (b.type === "toolCall") toolCalls++;
  }
  return { thinking, toolCalls };
}

/**
 * Characters a set of assistant blocks contributes to the streaming tps
 * estimate: each text / thinking block's length plus the serialized
 * tool-call input. Image blocks add nothing.
 *
 * This is the one place the streaming char count is computed — the chat
 * message view's live estimate and its tps tick both call it.
 */
export function countContentChars(blocks: readonly AssistantContentBlock[]): number {
  let chars = 0;
  for (const block of blocks) {
    if (block.type === "text") chars += block.text?.length ?? 0;
    else if (block.type === "thinking") chars += block.thinking?.length ?? 0;
    else if (block.type === "toolCall") chars += JSON.stringify(block.input ?? {}).length;
  }
  return chars;
}
