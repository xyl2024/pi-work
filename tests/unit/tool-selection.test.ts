import { describe, expect, it } from "vitest";
import {
  declarableToolNames,
  expandToolPatterns,
  isDeclarableTool,
} from "@/lib/shared/tool-selection";
import type { ToolExposure } from "@/lib/shared/types";

/**
 * Tool-selection helpers shared by the client picker and rpc-manager.
 *
 * The declarable filter exists because pi's tool loadout only drops `hidden`
 * tools: handing a `codemode`-exposure name (an MCP server's default) to
 * `setActiveToolsByName` would declare it to the model, which is the opposite
 * of what that exposure asks for. Every "activate these tools" path has to go
 * through it.
 */

describe("tool-selection: declarable tools", () => {
  it("treats an absent exposure as direct (pi's own default)", () => {
    expect(isDeclarableTool({})).toBe(true);
    expect(isDeclarableTool({ exposure: "direct" })).toBe(true);
    expect(isDeclarableTool({ exposure: "model-only" })).toBe(true);
  });

  it("excludes the discoverable and hidden exposures", () => {
    const exposures: ToolExposure[] = ["codemode", "deferred", "hidden"];
    for (const exposure of exposures) {
      expect(isDeclarableTool({ exposure })).toBe(false);
    }
  });

  it("keeps catalog order and drops non-declarable tools", () => {
    const names = declarableToolNames([
      { name: "read" },
      { name: "mcp__docs__search", exposure: "codemode" },
      { name: "codemode", exposure: "model-only" },
      { name: "mcp__gh__get", exposure: "direct" },
      { name: "mcp__gh__delete", exposure: "hidden" },
      { name: "mcp__jira__list", exposure: "deferred" },
    ]);

    expect(names).toEqual(["read", "codemode", "mcp__gh__get"]);
  });

  it("still expands prefix patterns for the tools that survive", () => {
    const all = ["mcp__docs__search", "mcp__docs__read", "mcp__gh__get"];
    const declarable = new Set(declarableToolNames([
      { name: "mcp__docs__search", exposure: "codemode" },
      { name: "mcp__docs__read", exposure: "codemode" },
      { name: "mcp__gh__get", exposure: "direct" },
    ]));

    expect(expandToolPatterns(["mcp__*"], all).filter((name) => declarable.has(name))).toEqual(["mcp__gh__get"]);
  });
});
