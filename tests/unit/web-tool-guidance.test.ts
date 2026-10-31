import { describe, expect, it } from "vitest";
import {
  composeAppendSystemPrompt,
  composeOverrideSystemPrompt,
  webToolGuidanceBlocks,
} from "@/lib/server/web-tool-guidance";
import {
  WEB_FETCH_SYSTEM_PROMPT_BLOCK,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_SYSTEM_PROMPT_BLOCK,
  WEB_SEARCH_TOOL_NAME,
} from "@/lib/shared/web-tools";

function hasTools(names: string[]) {
  const present = new Set(names);
  return (name: string) => present.has(name);
}

describe("web tool prompt guidance", () => {
  it("only includes the guidance block for a tool the session actually has", () => {
    expect(webToolGuidanceBlocks(hasTools([WEB_SEARCH_TOOL_NAME]))).toEqual([
      WEB_SEARCH_SYSTEM_PROMPT_BLOCK,
    ]);
    expect(webToolGuidanceBlocks(hasTools([WEB_FETCH_TOOL_NAME]))).toEqual([
      WEB_FETCH_SYSTEM_PROMPT_BLOCK,
    ]);
    expect(webToolGuidanceBlocks(hasTools([]))).toEqual([]);
  });

  it("appends guidance blocks to the default append prompt", () => {
    const blocks = webToolGuidanceBlocks(hasTools([WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME]));

    expect(
      composeAppendSystemPrompt({
        mode: "default",
        baseAppend: ["base"],
        sessionBlocks: ["session"],
        webBlocks: blocks,
      }),
    ).toEqual(["base", "session", WEB_SEARCH_SYSTEM_PROMPT_BLOCK, WEB_FETCH_SYSTEM_PROMPT_BLOCK]);
  });

  it("appends only the web guidance in prefix mode, leaving the existing blocks untouched", () => {
    const blocks = webToolGuidanceBlocks(hasTools([WEB_SEARCH_TOOL_NAME]));

    expect(
      composeAppendSystemPrompt({
        mode: "prefix",
        baseAppend: [],
        sessionBlocks: ["session"],
        webBlocks: blocks,
      }),
    ).toEqual([WEB_SEARCH_SYSTEM_PROMPT_BLOCK]);
  });

  it("does not change the append prompt in override mode", () => {
    expect(
      composeAppendSystemPrompt({
        mode: "override",
        baseAppend: ["base"],
        sessionBlocks: ["session"],
        webBlocks: [WEB_SEARCH_SYSTEM_PROMPT_BLOCK],
      }),
    ).toEqual(["base"]);
  });

  it("appends the web guidance to the full override prompt", () => {
    expect(composeOverrideSystemPrompt("profile prompt", [WEB_FETCH_SYSTEM_PROMPT_BLOCK])).toBe(
      `profile prompt\n\n${WEB_FETCH_SYSTEM_PROMPT_BLOCK}`,
    );
    expect(composeOverrideSystemPrompt("profile prompt", [])).toBe("profile prompt");
  });
});
