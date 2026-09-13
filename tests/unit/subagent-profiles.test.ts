import { describe, expect, it } from "vitest";
import { CODEGRAPH_TOOL_IDS } from "@/lib/shared/codegraph-tool-ids";
import { CODEBASE_EXPLORER_TOOLS, CODE_REVIEWER_TOOLS } from "@/lib/server/subagent-tool";

/**
 * Guards docs/adr/0001-subagent-toolsets-must-not-need-a-permission-prompt.md:
 * a subagent session has no UI to answer a permission prompt, so no profile may
 * carry a tool that raises one (`codegraph_build`), and a profile must never be
 * able to spawn more subagents or write files.
 */
describe("subagent profiles", () => {
  const profiles = [CODEBASE_EXPLORER_TOOLS, CODE_REVIEWER_TOOLS];

  it("gives every profile the query CodeGraph tools and never codegraph_build", () => {
    const queryTools = CODEGRAPH_TOOL_IDS.filter((id) => id !== "codegraph_build");
    for (const tools of profiles) {
      expect(tools).toEqual(expect.arrayContaining([...queryTools]));
      expect(tools).not.toContain("codegraph_build");
    }
  });

  it("keeps codebase_explorer read-only and gives code_reviewer bash", () => {
    expect(CODEBASE_EXPLORER_TOOLS).not.toContain("bash");
    expect(CODE_REVIEWER_TOOLS).toContain("bash");
  });

  it("never hands a profile a mutating or self-spawning tool", () => {
    for (const tools of profiles) {
      for (const forbidden of ["write", "edit", "spawn_subagent", "ask_user_questions"]) {
        expect(tools).not.toContain(forbidden);
      }
    }
  });
});
