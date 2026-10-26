import { describe, expect, it } from "vitest";
import { resolveSubagentSystemPrompt, subagentTools } from "@/lib/server/subagent-tool";

/**
 * Guards docs/adr/0001-subagent-toolsets-must-not-need-a-permission-prompt.md:
 * a subagent session has no UI to answer a permission prompt, so no profile may
 * carry a tool that raises one, and a profile must never be able to spawn more
 * subagents or write files.
 *
 * The tool set is asked for per platform (the same way the spawn path asks for
 * it), so both the Linux and the Windows branch are covered from one host.
 */
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

  // ADR-0015 removed the trio from the registry, so seeding a profile with it
  // would only write names pi's allowlist matcher silently drops.
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
