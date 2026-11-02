import {
  WEB_FETCH_SYSTEM_PROMPT_BLOCK,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_SYSTEM_PROMPT_BLOCK,
  WEB_SEARCH_TOOL_NAME,
} from "@/lib/shared/web-tools";

export type SystemPromptAppendMode = "default" | "prefix" | "override";

export function webToolGuidanceBlocks(sessionHasTool: (name: string) => boolean): string[] {
  const blocks: string[] = [];
  if (sessionHasTool(WEB_SEARCH_TOOL_NAME)) blocks.push(WEB_SEARCH_SYSTEM_PROMPT_BLOCK);
  if (sessionHasTool(WEB_FETCH_TOOL_NAME)) blocks.push(WEB_FETCH_SYSTEM_PROMPT_BLOCK);
  return blocks;
}

export function composeAppendSystemPrompt(input: {
  mode: SystemPromptAppendMode;
  baseAppend: string[];
  sessionBlocks: string[];
  webBlocks: string[];
  memoryBlock?: string | null;
}): string[] {
  if (input.mode === "override") return input.baseAppend;
  const memoryBlocks = input.memoryBlock ? [input.memoryBlock] : [];
  if (input.mode === "prefix") return [...input.baseAppend, ...input.webBlocks, ...memoryBlocks];
  return [...input.baseAppend, ...input.sessionBlocks, ...input.webBlocks, ...memoryBlocks];
}

export function composeOverrideSystemPrompt(
  overrideText: string,
  webBlocks: string[],
  memoryBlock?: string | null,
): string {
  const blocks = memoryBlock ? [...webBlocks, memoryBlock] : webBlocks;
  if (blocks.length === 0) return overrideText;
  return `${overrideText}\n\n${blocks.join("\n\n")}`;
}
