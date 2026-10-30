import { describe, expect, it } from "vitest";
import {
  entryUsesCodemode,
  projectMcpProblems,
  summarizeMcpProblems,
  type McpPanelData,
} from "@/lib/shared/mcp-panel";

function file(scope: "global" | "project", partial: Partial<McpPanelData["files"][number]> = {}) {
  return {
    scope,
    path: `/tmp/${scope}/mcp.json`,
    exists: true,
    parseError: null,
    autoEnableError: null,
    autoEnableCodemode: null,
    ...partial,
  };
}

function entry(name: string, error: string | null) {
  return {
    name,
    scope: "global" as const,
    rawJson: "{}",
    error,
    override: false,
    shadowsGlobal: false,
    shadowedByProject: false,
  };
}

function data(partial: Partial<McpPanelData>): McpPanelData {
  return { files: [], entries: [], projectTrusted: true, errors: [], ...partial };
}

describe("projectMcpProblems", () => {
  it("keeps file-level and entry-level problems apart", () => {
    const problems = projectMcpProblems(
      data({
        files: [file("global", { parseError: "unexpected end of JSON" }), file("project")],
        entries: [entry("good", null), entry("bad", 'server "bad" must be an object')],
        errors: [
          '/tmp/global/mcp.json: unexpected end of JSON',
          '/tmp/global/mcp.json: server "bad" must be an object',
        ],
      }),
    );

    expect(problems).toEqual([
      { scope: "global", level: "file", name: null, message: "unexpected end of JSON" },
      { scope: "global", level: "entry", name: "bad", message: 'server "bad" must be an object' },
    ]);
    expect(summarizeMcpProblems(problems)).toEqual({ files: 1, entries: 1 });
  });

  it("attributes an autoEnableCodemode type error to its file", () => {
    const problems = projectMcpProblems(
      data({
        files: [file("project", { autoEnableError: "autoEnableCodemode must be a boolean" })],
        errors: ['/tmp/project/mcp.json: autoEnableCodemode must be a boolean'],
      }),
    );

    expect(problems).toEqual([
      { scope: "project", level: "file", name: null, message: "autoEnableCodemode must be a boolean" },
    ]);
  });

  it("still surfaces a loader error nothing else explains", () => {
    const problems = projectMcpProblems(
      data({ errors: ['/tmp/global/mcp.json: server "x" conflicts with "x-y"'] }),
    );

    expect(problems).toEqual([
      { scope: null, level: "file", name: null, message: '/tmp/global/mcp.json: server "x" conflicts with "x-y"' },
    ]);
  });
});

describe("entryUsesCodemode", () => {
  it("is true for every exposure but direct, and false when unknown/unparsed", () => {
    expect(entryUsesCodemode({ command: "x" })).toBe(true);
    expect(entryUsesCodemode({ command: "x", exposure: "codemode" })).toBe(true);
    expect(entryUsesCodemode({ command: "x", exposure: "hidden" })).toBe(true);
    expect(entryUsesCodemode({ command: "x", exposure: "direct" })).toBe(false);
    expect(entryUsesCodemode(null)).toBe(false);
  });
});
