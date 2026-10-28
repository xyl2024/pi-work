import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import {
  DEFAULT_SUBAGENT_WAIT_MS,
  LEGACY_SPAWN_SUBAGENT_TOOL_NAME,
  SUBAGENT_TOOL_NAME,
  migrateToolNames,
} from "@/lib/shared/subagent";
import { SubagentParams, buildSubagentSystemPromptBlock, subagentTool } from "@/lib/server/subagent-tool";
import { readSessionToolSelection } from "@/lib/server/session-tools-config";

/**
 * The rename half of the lifecycle change: the tool is `subagent` only, old
 * stored selections migrate when they are loaded (so an existing session keeps
 * its subagent ability), old messages keep rendering, and a profile's stale
 * name cannot re-enable recursive delegation.
 *
 * Data lives in a temp root: the real `~/.pi-work` is never touched.
 */

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagent-migration-"));
  process.env.PI_WORK_DATA_DIR = dir;
});

afterAll(() => {
  delete process.env.PI_WORK_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("tool name", () => {
  it("registers only the new name", () => {
    expect(SUBAGENT_TOOL_NAME).toBe("subagent");
    expect(subagentTool.name).toBe(SUBAGENT_TOOL_NAME);
    expect(subagentTool.name).not.toBe(LEGACY_SPAWN_SUBAGENT_TOOL_NAME);
    expect(DEFAULT_SUBAGENT_WAIT_MS).toBe(15 * 60 * 1000);
  });

  it("validates parameters per action and rejects unknown actions", () => {
    const base = { subagent_name: "codebase_explorer", description: "explore", prompt: "look" };
    expect(Value.Check(SubagentParams, { action: "spawn", ...base })).toBe(true);
    expect(Value.Check(SubagentParams, { action: "spawn", ...base, wait_ms: 0 })).toBe(true);
    // `wait` observes an existing task: task_id plus the same bounded wait.
    expect(Value.Check(SubagentParams, { action: "wait", task_id: "subagent:x" })).toBe(true);
    expect(Value.Check(SubagentParams, { action: "wait", task_id: "subagent:x", wait_ms: 0 })).toBe(true);
    // `cancel` addresses exactly one task by id (the per-action allowlist is
    // enforced by parseSubagentParams; the flat schema only knows the fields).
    expect(Value.Check(SubagentParams, { action: "cancel", task_id: "subagent:x" })).toBe(true);
    // Unknown action, missing action, negative wait and stray properties are
    // all refused before any task is created.
    expect(Value.Check(SubagentParams, { action: "frobnicate", ...base })).toBe(false);
    expect(Value.Check(SubagentParams, base)).toBe(false);
    expect(Value.Check(SubagentParams, { action: "spawn", ...base, wait_ms: -1 })).toBe(false);
    expect(Value.Check(SubagentParams, { action: "spawn", ...base, extra: 1 })).toBe(false);
    expect(Value.Check(SubagentParams, { action: "spawn", ...base, prompt: "" })).toBe(false);
  });
});

describe("system prompt block", () => {
  it("documents the new tool and never the removed entry point", () => {
    const block = buildSubagentSystemPromptBlock([
      {
        name: "codebase_explorer",
        description: "Read-only exploration.",
        systemPrompt: "",
        tools: ["read"],
        inheritSystemPrompt: false,
        model: null,
        thinkingLevel: "off",
        bot: { expression: 0, stateKey: "idle", shapeId: "blob", parts: [], accessories: [] },
        timeoutMs: 1000,
        builtin: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    expect(block).toContain("`subagent`");
    expect(block).toContain("codebase_explorer");
    expect(block).not.toContain("spawn_subagent");
  });
});

describe("stored tool selections migrate on load", () => {
  it("maps the legacy name to the new one, order preserved and de-duplicated", () => {
    expect(migrateToolNames(["read", "spawn_subagent", "bash"])).toEqual(["read", "subagent", "bash"]);
    expect(migrateToolNames(["spawn_subagent", "subagent"])).toEqual(["subagent"]);
    // Idempotent: running it again changes nothing.
    expect(migrateToolNames(migrateToolNames(["spawn_subagent"]))).toEqual(["subagent"]);
  });

  it("migrates a session sidecar written before the rename", () => {
    const sidecarDir = join(dir, "session-tools");
    mkdirSync(sidecarDir, { recursive: true });
    writeFileSync(
      join(sidecarDir, "session-abc.json"),
      JSON.stringify({ selection: ["read", "spawn_subagent"], updatedAt: "2025-01-01T00:00:00Z" }),
      "utf8",
    );
    expect(readSessionToolSelection("session-abc")).toEqual(["read", "subagent"]);
  });

  it("migrates a cwd default written before the rename", async () => {
    writeFileSync(
      join(dir, "cwd-tools.json"),
      JSON.stringify({ "/tmp/work": ["spawn_subagent", "read"] }),
      "utf8",
    );
    const { readCwdToolSelection } = await import("@/lib/server/cwd-tools-config");
    expect(readCwdToolSelection("/tmp/work")).toEqual(["subagent", "read"]);
  });
});
