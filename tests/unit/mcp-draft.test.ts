import { describe, expect, it } from "vitest";
import {
  addDraftEntry,
  describedRemovals,
  describeStdioCommands,
  draftFromPanelData,
  isDraftDirty,
  mcpDraftProblem,
  mcpPendingChanges,
  withEntryConfig,
  withEntryRawJson,
} from "@/lib/shared/mcp-draft";
import { canonicalMcpJson, pruneMcpDefaults, type McpPanelData } from "@/lib/shared/mcp-panel";

/**
 * The MCP panel's draft model (lib/shared/mcp-draft.ts): server state arrives,
 * the user edits, and the save request must contain exactly the difference —
 * nothing more (a save that rewrites untouched entries is a save that can lose
 * someone else's edit) and nothing less.
 */

function panelData(entries: McpPanelData["entries"], files?: Partial<McpPanelData["files"][number]>[]): McpPanelData {
  return {
    files: [
      { scope: "global", path: "/agent/mcp.json", exists: true, parseError: null, autoEnableCodemode: null, ...files?.[0] },
      { scope: "project", path: "/cwd/.pi/mcp.json", exists: false, parseError: null, autoEnableCodemode: null, ...files?.[1] },
    ],
    entries,
    projectTrusted: false,
    errors: [],
  };
}

const docsEntry = {
  name: "docs",
  scope: "global",
  rawJson: JSON.stringify({ url: "https://example.com/mcp" }, null, 2),
  error: null,
  shadowsGlobal: false,
  shadowedByProject: false,
} as const;

describe("mcp-draft: entries", () => {
  it("starts clean and reports no changes", () => {
    const data = panelData([{ ...docsEntry }]);
    const draft = draftFromPanelData(data);

    expect(isDraftDirty(draft, data)).toBe(false);
    expect(mcpPendingChanges(draft, data)).toEqual([]);
  });

  it("sends one upsert after a form edit, and only for that entry", () => {
    const data = panelData([{ ...docsEntry }, { ...docsEntry, name: "other", rawJson: JSON.stringify({ command: "x" }) }]);
    const draft = draftFromPanelData(data);
    const edited = draft.entries.map((entry) =>
      entry.name === "docs" ? withEntryConfig(entry, { url: "https://example.com/mcp", timeout: 5 }) : entry,
    );

    const changes = mcpPendingChanges({ ...draft, entries: edited }, data);

    expect(changes).toEqual([
      { scope: "global", operations: [{ op: "upsert", name: "docs", config: { url: "https://example.com/mcp", timeout: 5 } }] },
    ]);
  });

  it("treats pi's default-valued keys as no change at all", () => {
    const data = panelData([{ ...docsEntry }]);
    const draft = draftFromPanelData(data);
    const same = draft.entries.map((entry) => withEntryConfig(entry, { url: "https://example.com/mcp", enabled: true, exposure: "codemode" }));

    expect(isDraftDirty({ ...draft, entries: same }, data)).toBe(false);
  });

  it("turns a rename into a remove plus an upsert so the old name does not survive", () => {
    const data = panelData([{ ...docsEntry }]);
    const draft = draftFromPanelData(data);
    const renamed = draft.entries.map((entry) => ({ ...entry, name: "documentation" }));

    expect(mcpPendingChanges({ ...draft, entries: renamed }, data)).toEqual([
      {
        scope: "global",
        operations: [
          { op: "remove", name: "docs" },
          { op: "upsert", name: "documentation", config: { url: "https://example.com/mcp" } },
        ],
      },
    ]);
  });

  it("deletes on save, not on click", () => {
    const data = panelData([{ ...docsEntry }]);
    const draft = draftFromPanelData(data);
    const marked = { ...draft, entries: draft.entries.map((entry) => ({ ...entry, deleted: true })) };

    expect(isDraftDirty(marked, data)).toBe(true);
    expect(mcpPendingChanges(marked, data)).toEqual([{ scope: "global", operations: [{ op: "remove", name: "docs" }] }]);

    // Undo restores the clean baseline.
    const undone = { ...draft, entries: draft.entries.map((entry) => ({ ...entry, deleted: false })) };
    expect(mcpPendingChanges(undone, data)).toEqual([]);
  });

  it("adds a new entry to the scope it is filed under, and drops it when cancelled", () => {
    const data = panelData([]);
    const empty = draftFromPanelData(data);
    const added = addDraftEntry(empty, "project");
    const filled = added.draft.entries.map((entry) => ({ ...entry, name: "files" }));

    expect(mcpPendingChanges({ ...added.draft, entries: filled }, data)).toEqual([
      {
        scope: "project",
        operations: [{ op: "upsert", name: "files", config: { command: "" } }],
      },
    ]);

    const cancelled = addDraftEntry(empty, "project");
    expect(mcpPendingChanges({ ...empty, entries: cancelled.draft.entries.filter((entry) => entry.uid !== cancelled.uid) }, data)).toEqual([]);
  });

  it("keeps a broken entry's text and blocks save until it is an object again", () => {
    const data = panelData([{ ...docsEntry, error: "server \"docs\" must be an object", rawJson: '"oops"' }]);
    const draft = draftFromPanelData(data);

    expect(draft.entries[0].config).toBeNull();
    // Nobody touched it, so it cannot block anything: it is never sent.
    expect(mcpDraftProblem(draft)).toBeNull();

    const half = draft.entries.map((entry) => withEntryRawJson(entry, '{ "command": '));
    expect(mcpDraftProblem({ ...draft, entries: half })).toEqual({ kind: "invalid-json", name: "docs" });

    const notAnObject = draft.entries.map((entry) => withEntryRawJson(entry, "[1, 2]"));
    expect(mcpDraftProblem({ ...draft, entries: notAnObject })).toEqual({ kind: "not-an-object", name: "docs" });

    const fixed = draft.entries.map((entry) => withEntryRawJson(entry, JSON.stringify({ command: "npx" }, null, 2)));
    expect(mcpDraftProblem({ ...draft, entries: fixed })).toBeNull();
    expect(mcpPendingChanges({ ...draft, entries: fixed }, data)).toEqual([
      { scope: "global", operations: [{ op: "upsert", name: "docs", config: { command: "npx" } }] },
    ]);
  });
});

describe("mcp-draft: problems", () => {
  it("rejects a name pi would refuse, and a duplicate in one file", () => {
    const data = panelData([{ ...docsEntry }]);
    const draft = draftFromPanelData(data);

    expect(mcpDraftProblem({ ...draft, entries: [{ ...draft.entries[0], name: "has space" }] })).toEqual({
      kind: "invalid-name",
      name: "has space",
    });
    expect(mcpDraftProblem({ ...draft, entries: [draft.entries[0], { ...draft.entries[0], uid: "global:docs2" }] })).toEqual({
      kind: "duplicate-name",
      scope: "global",
      name: "docs",
    });
  });

  it("allows the same name in the two different files (that is pi's override rule)", () => {
    const data = panelData([{ ...docsEntry }]);
    const draft = draftFromPanelData(data);
    const project = { ...draft.entries[0], uid: "project:docs", scope: "project" as const };

    expect(mcpDraftProblem({ ...draft, entries: [draft.entries[0], project] })).toBeNull();
  });

  it("requires a command or a URL — but only for entries this save would write", () => {
    const data = panelData([{ ...docsEntry, rawJson: JSON.stringify({ timeout: 5 }) }]);
    const draft = draftFromPanelData(data);

    // An entry pi already skips, untouched, is left alone instead of blocking.
    expect(mcpDraftProblem(draft)).toBeNull();

    const edited = draft.entries.map((entry) => withEntryConfig(entry, { timeout: 5, exposure: "direct" }));
    expect(mcpDraftProblem({ ...draft, entries: edited })).toEqual({ kind: "missing-transport", name: "docs" });
  });
});

describe("mcp-draft: file-level switch", () => {
  it("writes false when turned off and deletes the key when turned back on", () => {
    const data = panelData([], [{ autoEnableCodemode: null }]);
    const draft = draftFromPanelData(data);

    const off = { ...draft, autoEnableCodemode: { ...draft.autoEnableCodemode, global: false } };
    expect(mcpPendingChanges(off, data)).toEqual([{ scope: "global", operations: [], autoEnableCodemode: false }]);

    const on = { ...draft, autoEnableCodemode: { ...draft.autoEnableCodemode, global: true } };
    expect(mcpPendingChanges(on, data)).toEqual([]);
  });

  it("stores an explicit false on disk as the state the switch shows", () => {
    const data = panelData([], [{ autoEnableCodemode: false }]);
    const draft = draftFromPanelData(data);

    expect(draft.autoEnableCodemode.global).toBe(false);
    expect(mcpPendingChanges(draft, data)).toEqual([]);
    expect(mcpPendingChanges({ ...draft, autoEnableCodemode: { ...draft.autoEnableCodemode, global: true } }, data)).toEqual([
      { scope: "global", operations: [], autoEnableCodemode: null },
    ]);
  });
});

describe("mcp-draft: what the save gate lists", () => {
  it("names the entries that would be deleted and the commands that would be spawned", () => {
    const changes = [
      {
        scope: "global" as const,
        operations: [
          { op: "remove" as const, name: "old" },
          { op: "upsert" as const, name: "files", config: { command: "npx", args: ["-y", "server", "."] } },
          { op: "upsert" as const, name: "docs", config: { url: "https://example.com/mcp" } },
        ],
      },
    ];

    expect(describedRemovals(changes)).toEqual(["old"]);
    expect(describeStdioCommands(changes)).toEqual(["npx -y server ."]);
  });
});

describe("mcp-panel: normalization", () => {
  it("prunes only what pi treats as a default", () => {
    expect(pruneMcpDefaults({ command: "x", enabled: true, exposure: "codemode", args: [], env: {}, headers: {} })).toEqual({
      command: "x",
    });
    expect(pruneMcpDefaults({ command: "x", enabled: false, exposure: "direct", toolExposure: { a: "hidden" } })).toEqual({
      command: "x",
      enabled: false,
      exposure: "direct",
      toolExposure: { a: "hidden" },
    });
  });

  it("compares entries independently of key order", () => {
    expect(canonicalMcpJson({ command: "x", timeout: 5 })).toBe(canonicalMcpJson({ timeout: 5, command: "x" }));
    expect(canonicalMcpJson({ command: "x" })).not.toBe(canonicalMcpJson({ command: "y" }));
  });
});
