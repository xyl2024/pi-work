import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  ImageContent,
  TextContent,
} from "./types";

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

export function countImages(message: AgentMessage): number {
  return extractMessageImages(message).length;
}

export interface RoundStats {
  thinking: number;
  toolCalls: number;
}

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

export function countContentChars(blocks: readonly AssistantContentBlock[]): number {
  let chars = 0;
  for (const block of blocks) {
    if (block.type === "text") chars += block.text?.length ?? 0;
    else if (block.type === "thinking") chars += block.thinking?.length ?? 0;
    else if (block.type === "toolCall") chars += JSON.stringify(block.input ?? {}).length;
  }
  return chars;
}
