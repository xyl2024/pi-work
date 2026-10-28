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
import { BUILTIN_SUBAGENT_SEEDS } from "@/lib/server/subagent-profiles";
import { DEFAULT_SUBAGENT_BOT, type SubagentProfile, type SubagentProfileInput } from "@/lib/shared/subagent";
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

  /**
   * The block is per-session context: it may only carry what the tool
   * description, the parameter schema and the tool results cannot. This cap is
   * the guard against the guidelines quietly growing back into a second copy of
   * the tool description, so raise it only with a matching reason here.
   */
  const BLOCK_CHAR_BUDGET = 800;

  /** The real seeded catalog: the largest block a fresh install can produce. */
  const builtinProfiles = BUILTIN_SUBAGENT_SEEDS.map(asProfile);

  it("stays inside its character budget with the built-in catalog", () => {
    const block = buildSubagentSystemPromptBlock(builtinProfiles);
    expect(block.length).toBeLessThanOrEqual(BLOCK_CHAR_BUDGET);
  });

  it("still lists every configured profile name and description", () => {
    const block = buildSubagentSystemPromptBlock(builtinProfiles);
    for (const profile of builtinProfiles) {
      // The catalog is the one part of the block the model cannot infer: it is
      // what the profile choice is made from.
      expect(block).toContain(`\`${profile.name}\`: ${profile.description}`);
    }
  });

  it("does not repeat what the tool description and schema already state", () => {
    const block = buildSubagentSystemPromptBlock(builtinProfiles);
    for (const fact of ["15 minutes", "request_id", "at most 4", "runtime limit", "bounded"]) {
      expect(block).not.toContain(fact);
    }
    // ...but keeps the one state a parent misreads, and both preferences that
    // no profile prompt covers.
    expect(block).toContain("not failed and not cancelled");
    expect(block).toContain("Prefer a read-only explorer");
    expect(block).toContain("state the standards to judge against");
  });

  it("says so instead of listing profiles when none are configured", () => {
    const block = buildSubagentSystemPromptBlock([]);
    expect(block).toContain("no subagents are configured yet");
    expect(block.length).toBeLessThanOrEqual(BLOCK_CHAR_BUDGET);
  });
});

describe("tool description", () => {
  /**
   * The description is the shortest it can be: per-action semantics belong to
   * the `action` enum and the parameter descriptions, runtime states to the tool
   * results. This cap keeps a future edit from re-inlining them here.
   */
  const DESCRIPTION_CHAR_BUDGET = 160;

  it("names every action with its real name", () => {
    // Synonyms here would make the model call `action: "observe"` instead of
    // `"wait"`, so the literal names are the contract.
    for (const action of ["spawn", "wait", "continue", "list", "get", "cancel"]) {
      expect(subagentTool.description).toContain(action);
    }
  });

  it("stays inside its character budget", () => {
    expect(subagentTool.description.length).toBeLessThanOrEqual(DESCRIPTION_CHAR_BUDGET);
  });

  it("leaves defaults and state transitions to the schema and the results", () => {
    for (const fact of ["15 minutes", "wait_ms", "request_id", "stopping", "task_id"]) {
      expect(subagentTool.description).not.toContain(fact);
    }
  });
});

function asProfile(seed: SubagentProfileInput, index: number): SubagentProfile {
  return {
    name: seed.name,
    description: seed.description,
    systemPrompt: seed.systemPrompt,
    tools: [...seed.tools],
    inheritSystemPrompt: seed.inheritSystemPrompt ?? false,
    model: seed.model,
    thinkingLevel: seed.thinkingLevel ?? "off",
    bot: seed.bot ?? { ...DEFAULT_SUBAGENT_BOT },
    timeoutMs: seed.timeoutMs,
    builtin: true,
    createdAt: index,
    updatedAt: index,
  };
}

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
