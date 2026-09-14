import { describe, expect, it } from "vitest";
import {
  classifyToolCall,
  isToolResultEmpty,
  summarizeTurn,
  toolCallDiffStats,
  type ToolCallKind,
  type ToolPathResolver,
} from "@/lib/shared/tool-call-display";
import type {
  AgentMessage,
  AssistantMessage,
  ToolResultMessage,
} from "@/lib/shared/types";

// ── Fixtures ──
//
// These deliberately mirror the shapes the chat window / tool-stats panel /
// kanban read off real sessions: an assistant message carrying toolCall
// blocks, and an id → toolResult map.

function assistantWithCalls(
  calls: Array<{ id: string; toolName: string; input: Record<string, unknown> }>,
): AssistantMessage {
  return {
    role: "assistant",
    model: "test-model",
    provider: "test-provider",
    content: calls.map((c) => ({
      type: "toolCall" as const,
      toolCallId: c.id,
      toolName: c.toolName,
      input: c.input,
    })),
  };
}

function textResult(
  toolCallId: string,
  text: string,
  extra?: Partial<ToolResultMessage>,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    content: [{ type: "text", text }],
    ...extra,
  };
}

/** A stand-in for the caller-owned `resolveReadPath`: absolute paths pass
 *  through, relative paths join the cwd, no cwd → unresolvable. */
const resolvePath: ToolPathResolver = (raw, cwd) =>
  raw.startsWith("/") ? raw : cwd ? `${cwd}/${raw}` : null;

/** Unified patch with one added and one deleted line. */
const PATCH_ONE_ONE = ["@@ -1,2 +1,2 @@", "-old", "+new", " context"].join("\n");

describe("classifyToolCall", () => {
  it("maps the tool names the chat UI switches on today", () => {
    const cases: Record<string, ToolCallKind> = {
      read: "read",
      edit: "file-mutation",
      write: "file-mutation",
      bash: "bash",
      spawn_subagent: "subagent",
      grep: "other",
      find: "other",
      ls: "other",
      codegraph_search: "other",
      "": "other",
    };
    for (const [toolName, kind] of Object.entries(cases)) {
      expect(classifyToolCall(toolName), toolName).toBe(kind);
    }
  });
});

describe("toolCallDiffStats", () => {
  it("takes edit counts from the result details' unified patch", () => {
    const stats = toolCallDiffStats(
      { toolName: "edit", input: { path: "/repo/a.ts" } },
      textResult("e1", "ok", { details: { patch: PATCH_ONE_ONE } }),
    );
    expect(stats).toEqual({ additions: 1, deletions: 1 });
  });

  it("falls back to edit's display diff", () => {
    const stats = toolCallDiffStats(
      { toolName: "edit", input: { path: "/repo/a.ts" } },
      textResult("e1", "ok", { details: { diff: "+1 new\n-2 old" } }),
    );
    expect(stats).toEqual({ additions: 1, deletions: 1 });
  });

  it("takes write counts from the tool input content (no result needed)", () => {
    const stats = toolCallDiffStats({
      toolName: "write",
      input: { path: "/repo/a.ts", content: "line1\nline2\n" },
    });
    expect(stats).toEqual({ additions: 2, deletions: 0 });
  });

  it("returns null for an errored edit / write", () => {
    expect(
      toolCallDiffStats(
        { toolName: "edit", input: { path: "/repo/a.ts" } },
        textResult("e1", "boom", { isError: true, details: { patch: PATCH_ONE_ONE } }),
      ),
    ).toBeNull();
    expect(
      toolCallDiffStats(
        { toolName: "write", input: { path: "/repo/a.ts", content: "line\n" } },
        textResult("w1", "boom", { isError: true }),
      ),
    ).toBeNull();
  });

  it("returns null when the tool is not a file mutation or the data is missing", () => {
    expect(
      toolCallDiffStats({ toolName: "read", input: { path: "/repo/a.ts" } }, textResult("r1", "ok")),
    ).toBeNull();
    expect(
      toolCallDiffStats({ toolName: "edit", input: { path: "/repo/a.ts" } }, textResult("e1", "ok")),
    ).toBeNull();
    expect(toolCallDiffStats({ toolName: "write", input: { path: "/repo/a.ts" } })).toBeNull();
  });
});

describe("isToolResultEmpty", () => {
  it("treats a missing result as not empty (nothing to judge yet)", () => {
    expect(isToolResultEmpty(undefined)).toBe(false);
  });

  it("normalizes the empty string and pi's '(no output)' marker", () => {
    expect(isToolResultEmpty(textResult("t1", ""))).toBe(true);
    expect(isToolResultEmpty(textResult("t1", "   \n  "))).toBe(true);
    expect(isToolResultEmpty(textResult("t1", "(no output)"))).toBe(true);
    expect(isToolResultEmpty(textResult("t1", "  (no output) \n"))).toBe(true);
  });

  it("is false when the result carries text and true with no text blocks", () => {
    expect(isToolResultEmpty(textResult("t1", "actual output"))).toBe(false);
    expect(
      isToolResultEmpty({ role: "toolResult", toolCallId: "t1", content: [] }),
    ).toBe(true);
  });
});

describe("summarizeTurn", () => {
  it("merges a file that was read then edited into a single read-first chip", () => {
    const messages: AgentMessage[] = [
      assistantWithCalls([
        { id: "r1", toolName: "read", input: { path: "src/a.ts" } },
        { id: "e1", toolName: "edit", input: { path: "src/a.ts" } },
      ]),
    ];
    const resultsById = new Map<string, ToolResultMessage>([
      ["r1", textResult("r1", "file body")],
      ["e1", textResult("e1", "edited", { details: { patch: PATCH_ONE_ONE } })],
    ]);

    const summary = summarizeTurn(messages, resultsById, "/repo", resolvePath);

    expect(summary.readFiles).toHaveLength(1);
    expect(summary.readFiles[0]).toEqual({
      path: "/repo/src/a.ts",
      name: "a.ts",
      diffStats: { additions: 1, deletions: 1 },
    });
    expect(summary.diffStats).toEqual({ additions: 1, deletions: 1 });
  });

  it("keeps the mutation's stats when the file is edited before it is read", () => {
    const messages: AgentMessage[] = [
      assistantWithCalls([
        { id: "e1", toolName: "edit", input: { path: "src/a.ts" } },
        { id: "r1", toolName: "read", input: { path: "src/a.ts" } },
      ]),
    ];
    const resultsById = new Map<string, ToolResultMessage>([
      ["e1", textResult("e1", "edited", { details: { patch: PATCH_ONE_ONE } })],
      ["r1", textResult("r1", "file body")],
    ]);

    const summary = summarizeTurn(messages, resultsById, "/repo", resolvePath);

    expect(summary.readFiles).toHaveLength(1);
    expect(summary.readFiles[0].diffStats).toEqual({ additions: 1, deletions: 1 });
    expect(summary.diffStats).toEqual({ additions: 1, deletions: 1 });
  });

  it("keeps a read-only file's chip free of stats and dedupes repeat reads", () => {
    const messages: AgentMessage[] = [
      assistantWithCalls([
        { id: "r1", toolName: "read", input: { path: "src/a.ts" } },
        { id: "r2", toolName: "read", input: { path: "src/a.ts" } },
        { id: "r3", toolName: "read", input: { path: "src/b.ts" } },
      ]),
    ];
    const resultsById = new Map<string, ToolResultMessage>([
      ["r1", textResult("r1", "a")],
      ["r2", textResult("r2", "a")],
      ["r3", textResult("r3", "b")],
    ]);

    const summary = summarizeTurn(messages, resultsById, "/repo", resolvePath);

    expect(summary.readFiles.map((f) => f.path)).toEqual(["/repo/src/a.ts", "/repo/src/b.ts"]);
    expect(summary.readFiles[0].diffStats).toBeNull();
    expect(summary.diffStats).toBeNull();
  });

  it("skips errored read / edit / write calls from both chips and totals", () => {
    const messages: AgentMessage[] = [
      assistantWithCalls([
        { id: "r1", toolName: "read", input: { path: "src/missing.ts" } },
        { id: "e1", toolName: "edit", input: { path: "src/a.ts" } },
        { id: "w1", toolName: "write", input: { path: "src/b.ts", content: "x\ny\n" } },
      ]),
    ];
    const resultsById = new Map<string, ToolResultMessage>([
      ["r1", textResult("r1", "ENOENT", { isError: true })],
      ["e1", textResult("e1", "boom", { isError: true, details: { patch: PATCH_ONE_ONE } })],
      ["w1", textResult("w1", "boom", { isError: true })],
    ]);

    const summary = summarizeTurn(messages, resultsById, "/repo", resolvePath);

    expect(summary.readFiles).toEqual([]);
    expect(summary.diffStats).toBeNull();
  });

  it("sums write counts from input and edit counts from details across the turn", () => {
    const messages: AgentMessage[] = [
      assistantWithCalls([
        { id: "w1", toolName: "write", input: { path: "src/b.ts", content: "one\ntwo\nthree\n" } },
      ]),
      assistantWithCalls([
        { id: "e1", toolName: "edit", input: { path: "src/a.ts" } },
      ]),
    ];
    const resultsById = new Map<string, ToolResultMessage>([
      ["w1", textResult("w1", "written")],
      ["e1", textResult("e1", "edited", { details: { patch: PATCH_ONE_ONE } })],
    ]);

    const summary = summarizeTurn(messages, resultsById, "/repo", resolvePath);

    expect(summary.readFiles.map((f) => f.path)).toEqual(["/repo/src/b.ts", "/repo/src/a.ts"]);
    expect(summary.readFiles[0].diffStats).toEqual({ additions: 3, deletions: 0 });
    expect(summary.readFiles[1].diffStats).toEqual({ additions: 1, deletions: 1 });
    expect(summary.diffStats).toEqual({ additions: 4, deletions: 1 });
  });

  it("counts a mutation without a resolvable path in the total but not as a chip", () => {
    const messages: AgentMessage[] = [
      assistantWithCalls([
        { id: "w1", toolName: "write", input: { content: "solo\n" } },
        { id: "r1", toolName: "read", input: { path: "src/relative.ts" } },
      ]),
    ];
    const resultsById = new Map<string, ToolResultMessage>([["w1", textResult("w1", "written")]]);

    const summary = summarizeTurn(messages, resultsById, null, resolvePath);

    expect(summary.readFiles).toEqual([]);
    expect(summary.diffStats).toEqual({ additions: 1, deletions: 0 });
  });
});
