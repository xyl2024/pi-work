import { describe, expect, it } from "vitest";
import { CODEGRAPH_TOOL_IDS } from "@/lib/shared/codegraph-tool-ids";
import { subagentTools } from "@/lib/server/subagent-tool";

/**
 * Guards docs/adr/0001-subagent-toolsets-must-not-need-a-permission-prompt.md:
 * a subagent session has no UI to answer a permission prompt, so no profile may
 * carry a tool that raises one (`codegraph_build`), and a profile must never be
 * able to spawn more subagents or write files.
 *
 * The tool set is asked for per platform (the same way the spawn path asks for
 * it), so both the Linux and the Windows branch are covered from one host.
 */
describe("subagent profiles", () => {
  const PLATFORMS = ["linux", "win32"];

  it("gives every profile the query CodeGraph tools and never codegraph_build", () => {
    const queryTools = CODEGRAPH_TOOL_IDS.filter((id) => id !== "codegraph_build");
    for (const platform of PLATFORMS) {
      const tools = subagentTools(platform);
      expect(tools).toEqual(expect.arrayContaining([...queryTools]));
      expect(tools).not.toContain("codegraph_build");
    }
  });

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
});
