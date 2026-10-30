import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  ThinkingContent,
} from "./types";

interface DisplayOptions {
  isStreaming?: boolean;
}

export function isEmptyThinkingBlock(
  block: AssistantContentBlock,
  options: DisplayOptions = {},
): block is ThinkingContent {
  return (
    block.type === "thinking" &&
    !options.isStreaming &&
    block.thinking.trim() === ""
  );
}

export function getDisplayableAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): AssistantContentBlock[] {
  return (message.content ?? []).filter(
    (block) => !isEmptyThinkingBlock(block, options),
  );
}

function isFinalAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === "text" || block.type === "image";
}

export function splitFinalAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): { answerBlocks: AssistantContentBlock[]; processBlocks: AssistantContentBlock[] } {
  const blocks = getDisplayableAssistantBlocks(message, options);
  const lastProcessIndex = blocks.findLastIndex(
    (block) => !isFinalAnswerBlock(block),
  );
  if (lastProcessIndex === -1) {
    return { answerBlocks: blocks, processBlocks: [] };
  }
  return {
    answerBlocks: blocks.slice(lastProcessIndex + 1),
    processBlocks: blocks.slice(0, lastProcessIndex + 1),
  };
}

export function countToolCallsByName(
  messages: AgentMessage[],
  indices: number[],
  extraBlocks: AssistantContentBlock[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  const tally = (blocks: AssistantContentBlock[]) => {
    for (const b of blocks) {
      if (b.type === "toolCall") {
        counts[b.toolName] = (counts[b.toolName] ?? 0) + 1;
      }
    }
  };
  for (const i of indices) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    tally(msg.content ?? []);
  }
  tally(extraBlocks);
  return counts;
}