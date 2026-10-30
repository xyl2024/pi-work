import { describe, expect, it } from "vitest";
import { resolveSubagentSystemPrompt, subagentTools } from "@/lib/server/subagent-tool";

describe("subagent profiles", () => {
  const PLATFORMS = ["linux", "win32"];

  it("gives every profile a shell on every platform: bash everywhere, PowerShell on Windows", () => {
    expect(subagentTools("linux")).toContain("bash");
    expect(subagentTools("win32")).toContain("bash");
    expect(subagentTools("linux")).not.toContain("powershell");
    expect(subagentTools("win32")).toContain("powershell");
  });

  it("never hands a profile a mutating or self-spawning tool", () => {
    for (const platform of PLATFORMS) {
      for (const forbidden of ["write", "edit", "spawn_subagent", "ask_user_questions"]) {
        expect(subagentTools(platform)).not.toContain(forbidden);
      }
    }
  });

  it("explores with read plus a shell, not with the removed search-and-list trio", () => {
    for (const platform of PLATFORMS) {
      expect(subagentTools(platform)).toContain("read");
      for (const removed of ["grep", "find", "ls"]) {
        expect(subagentTools(platform)).not.toContain(removed);
      }
    }
  });
});

describe("subagent system prompt", () => {
  it("copies the parent prompt verbatim when the profile inherits it", () => {
    const resolved = resolveSubagentSystemPrompt(
      { inheritSystemPrompt: true, systemPrompt: "fallback prompt" },
      "PARENT PROMPT",
      "/work",
    );
    expect(resolved).toEqual({ systemPromptOverride: "PARENT PROMPT" });
  });

  it("prefixes a custom prompt with the child's working directory", () => {
    const resolved = resolveSubagentSystemPrompt(
      { inheritSystemPrompt: false, systemPrompt: "Do the task." },
      "PARENT PROMPT",
      "/work",
    );
    expect(resolved).toEqual({
      systemPromptPrefix: "Do the task.\n\nYour current working directory is /work",
    });
  });

  it("fails instead of falling back when the parent prompt is unavailable", () => {
    expect(() => resolveSubagentSystemPrompt(
      { inheritSystemPrompt: true, systemPrompt: "fallback prompt" },
      "   ",
      "/work",
    )).toThrow(/no system prompt/i);
  });
});
