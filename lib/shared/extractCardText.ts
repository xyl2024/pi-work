import type {
  AgentMessage,
  AssistantMessage,
  AssistantContentBlock,
  ImageContent,
  TextContent,
} from "./types";

/**
 * Pull text out of an AgentMessage for display in the conversation-tree map.
 * - User messages: string content (joined raw) or joined text blocks.
 * - Assistant messages: joined text blocks.
 * - ToolResult / custom: joined text blocks (rarely a card, but defensive).
 *
 * Empty string is meaningful — used to detect "this final assistant had no
 * text" and fall back to the [完成工具调用] / [发送了图片] placeholder.
 */
export function extractMessageText(message: AgentMessage): string {
  if (message.role === "user") {
    const c = message.content;
    if (typeof c === "string") return c;
    return c
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  if (message.role === "assistant") {
    return message.content
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  if (message.role === "toolResult") {
    return message.content
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  if (message.role === "custom") {
    const c = message.content;
    if (typeof c === "string") return c;
    return c
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  return "";
}

export function countImages(message: AgentMessage): number {
  if (message.role === "user") {
    const c = message.content;
    if (typeof c === "string") return 0;
    return c.filter((b): b is ImageContent => b.type === "image").length;
  }
  if (message.role === "assistant" || message.role === "toolResult") {
    return (message.content as Array<AssistantContentBlock | TextContent | ImageContent>)
      .filter((b): b is ImageContent => b.type === "image")
      .length;
  }
  if (message.role === "custom") {
    const c = message.content;
    if (typeof c === "string") return 0;
    return c.filter((b): b is ImageContent => b.type === "image").length;
  }
  return 0;
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