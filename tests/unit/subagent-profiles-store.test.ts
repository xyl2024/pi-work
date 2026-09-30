import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Store-level tests for the user-defined subagent profiles: seeding the
 * built-ins into a fresh database, CRUD, and the one-shot rename of
 * `subagent_tasks.subagent_type` → `subagent_name` on a legacy database.
 *
 * The store caches its handle on globalThis and reads `PI_WORK_SUBAGENTS_DB`
 * on every open, so each test points the env var at its own temp file and
 * clears the cached globals before importing.
 */

let dir: string;
let dbPath: string;

function resetStoreGlobals(): void {
  delete (globalThis as { __piSubagentsDb?: unknown }).__piSubagentsDb;
  delete (globalThis as { __piSubagentProfilesSeeded?: unknown }).__piSubagentProfilesSeeded;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-work-subagents-"));
  dbPath = join(dir, "subagents.db");
  process.env.PI_WORK_SUBAGENTS_DB = dbPath;
});

afterAll(() => {
  resetStoreGlobals();
  delete process.env.PI_WORK_SUBAGENTS_DB;
  rmSync(dir, { recursive: true, force: true });
});

describe("subagent profile store", () => {
  it("seeds the two built-ins into an empty database", async () => {
    resetStoreGlobals();
    const { listSubagentProfiles } = await import("@/lib/server/subagent-profiles");
    const profiles = listSubagentProfiles();
    expect(profiles.map((profile) => profile.name).sort()).toEqual(["code_reviewer", "codebase_explorer"]);
    for (const profile of profiles) {
      expect(profile.builtin).toBe(true);
      expect(profile.systemPrompt.length).toBeGreaterThan(0);
      expect(profile.tools).toContain("read");
      expect(profile.bot.shapeId).toBeTruthy();
      expect(profile.timeoutMs).toBeGreaterThanOrEqual(10_000);
    }
  });

  it("creates, updates and deletes a custom profile", async () => {
    resetStoreGlobals();
    const {
      createSubagentProfile, deleteSubagentProfile, getSubagentProfile, updateSubagentProfile,
    } = await import("@/lib/server/subagent-profiles");

    const created = createSubagentProfile({
      name: "docs_writer",
      description: "Writes documentation.",
      systemPrompt: "Write docs.",
      tools: ["read", "write"],
      model: { provider: "anthropic", modelId: "claude" },
      thinkingLevel: "low",
      bot: { expression: 3, stateKey: "writing", shapeId: "cloud", parts: ["hands"], accessories: [] },
      timeoutMs: 60_000,
    });
    expect(created.builtin).toBe(false);
    expect(created.model).toEqual({ provider: "anthropic", modelId: "claude" });

    const updated = updateSubagentProfile({ ...created, description: "Updated.", tools: ["read"] });
    expect(updated.description).toBe("Updated.");
    expect(updated.tools).toEqual(["read"]);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);

    expect(getSubagentProfile("docs_writer")).not.toBeNull();
    expect(deleteSubagentProfile("docs_writer")).toBe(true);
    expect(getSubagentProfile("docs_writer")).toBeNull();
    expect(deleteSubagentProfile("docs_writer")).toBe(false);
  });

  it("refuses a duplicate name", async () => {
    resetStoreGlobals();
    const { createSubagentProfile, SubagentProfileError } = await import("@/lib/server/subagent-profiles");
    const input = {
      name: "dup",
      description: "d",
      systemPrompt: "p",
      tools: [] as string[],
      model: null,
      thinkingLevel: "off" as const,
      bot: { expression: 0, stateKey: "idle", shapeId: "blob", parts: [], accessories: [] },
      timeoutMs: 30_000,
    };
    createSubagentProfile(input);
    expect(() => createSubagentProfile(input)).toThrow(SubagentProfileError);
  });

  it("renames a legacy subagent_tasks column on open", async () => {
    resetStoreGlobals();
    const legacyPath = join(dir, "legacy.db");
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE subagent_tasks (
        task_id TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL,
        child_session_id TEXT,
        subagent_type TEXT NOT NULL,
        description TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER
      );
    `);
    legacy.prepare(`
      INSERT INTO subagent_tasks
        (task_id, parent_session_id, subagent_type, description, prompt, status, created_at)
      VALUES ('t1', 'p1', 'codebase_explorer', 'd', 'p', 'completed', 1)
    `).run();
    legacy.close();

    process.env.PI_WORK_SUBAGENTS_DB = legacyPath;
    resetStoreGlobals();
    const { listSubagentTasks } = await import("@/lib/server/subagent-store");
    const tasks = listSubagentTasks("p1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subagentName).toBe("codebase_explorer");

    // Resetting the env back to this test file's DB for any later test.
    process.env.PI_WORK_SUBAGENTS_DB = dbPath;
    resetStoreGlobals();
  });
});

describe("normalizeSubagentProfileInput", () => {
  it("rejects an invalid name and empty prompt", async () => {
    const { normalizeSubagentProfileInput, SubagentProfileError } = await import("@/lib/server/subagent-profiles");
    expect(() => normalizeSubagentProfileInput({ name: "Bad Name", description: "d", systemPrompt: "p" }))
      .toThrow(SubagentProfileError);
    expect(() => normalizeSubagentProfileInput({ name: "ok", description: "d", systemPrompt: "" }))
      .toThrow(SubagentProfileError);
  });

  it("defaults and normalizes optional fields", async () => {
    const { normalizeSubagentProfileInput } = await import("@/lib/server/subagent-profiles");
    const input = normalizeSubagentProfileInput({
      name: "my_agent",
      description: "  hello  ",
      systemPrompt: "  do things  ",
      tools: ["read", "read", ""],
    });
    expect(input.description).toBe("hello");
    expect(input.systemPrompt).toBe("do things");
    expect(input.tools).toEqual(["read"]);
    expect(input.model).toBeNull();
    expect(input.thinkingLevel).toBe("off");
    expect(input.timeoutMs).toBeGreaterThan(0);
    expect(input.bot.shapeId).toBeTruthy();
  });
});
