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
}): string[] {
  if (input.mode === "override") return input.baseAppend;
  if (input.mode === "prefix") return [...input.baseAppend, ...input.webBlocks];
  return [...input.baseAppend, ...input.sessionBlocks, ...input.webBlocks];
}

export function composeOverrideSystemPrompt(overrideText: string, webBlocks: string[]): string {
  if (webBlocks.length === 0) return overrideText;
  return `${overrideText}\n\n${webBlocks.join("\n\n")}`;
}
