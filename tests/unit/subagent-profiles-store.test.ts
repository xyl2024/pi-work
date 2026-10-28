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
  it("seeds the built-ins into an empty database", async () => {
    resetStoreGlobals();
    const { listSubagentProfiles } = await import("@/lib/server/subagent-profiles");
    const profiles = listSubagentProfiles();
    expect(profiles.map((profile) => profile.name).sort()).toEqual([
      "code_reviewer", "codebase_explorer", "implementer",
    ]);
    for (const profile of profiles) {
      expect(profile.builtin).toBe(true);
      if (!profile.inheritSystemPrompt) expect(profile.systemPrompt.length).toBeGreaterThan(0);
      expect(profile.tools).toContain("read");
      expect(profile.bot.shapeId).toBeTruthy();
      expect(profile.timeoutMs).toBeGreaterThanOrEqual(10_000);
    }

    const implementer = profiles.find((profile) => profile.name === "implementer");
    expect(implementer).toMatchObject({
      inheritSystemPrompt: true,
      systemPrompt: "",
      tools: ["read", "edit", "write", "bash", "codemode"],
      model: null,
      thinkingLevel: "off",
      timeoutMs: 30 * 60 * 1000,
    });
  });

  it("adds the implementer built-in when upgrading a pre-versioned database", async () => {
    const upgradePath = join(dir, "upgrade.db");
    const legacy = new Database(upgradePath);
    legacy.exec(`
      CREATE TABLE subagent_profiles (
        name           TEXT PRIMARY KEY,
        description    TEXT NOT NULL,
        system_prompt  TEXT NOT NULL,
        tools          TEXT NOT NULL,
        model_provider TEXT,
        model_id       TEXT,
        thinking_level TEXT NOT NULL,
        bot            TEXT NOT NULL,
        timeout_ms     INTEGER NOT NULL,
        builtin        INTEGER NOT NULL DEFAULT 0,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      );
    `);
    legacy.prepare(`
      INSERT INTO subagent_profiles
        (name, description, system_prompt, tools, thinking_level, bot, timeout_ms, builtin, created_at, updated_at)
      VALUES ('codebase_explorer', 'old', 'old prompt', '["read"]', 'off', '{}', 10000, 1, 1, 1)
    `).run();
    legacy.close();

    process.env.PI_WORK_SUBAGENTS_DB = upgradePath;
    resetStoreGlobals();
    const { deleteSubagentProfile, listSubagentProfiles } = await import("@/lib/server/subagent-profiles");

    const upgraded = listSubagentProfiles();
    expect(upgraded.map((profile) => profile.name).sort()).toEqual(["codebase_explorer", "implementer"]);
    const implementer = upgraded.find((profile) => profile.name === "implementer");
    expect(implementer?.inheritSystemPrompt).toBe(true);
    expect(implementer?.tools).toEqual(["read", "edit", "write", "bash", "codemode"]);

    // The upgrade runs once: a deleted built-in must not come back on restart.
    expect(deleteSubagentProfile("implementer")).toBe(true);
    resetStoreGlobals();
    const reloaded = (await import("@/lib/server/subagent-profiles")).listSubagentProfiles();
    expect(reloaded.map((profile) => profile.name)).not.toContain("implementer");

    process.env.PI_WORK_SUBAGENTS_DB = dbPath;
    resetStoreGlobals();
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

describe("profile tool-name migration", () => {
  it("migrates a stored pre-rename tool name on load", async () => {
    resetStoreGlobals();
    const { getSubagentDb } = await import("@/lib/server/subagent-store");
    const { getSubagentProfile, listSubagentProfiles } = await import("@/lib/server/subagent-profiles");
    // Seeding happens on first read; make sure the table exists.
    listSubagentProfiles();
    getSubagentDb().prepare(`
      INSERT INTO subagent_profiles
        (name, description, system_prompt, inherit_system_prompt, tools, model_provider, model_id,
         thinking_level, bot, timeout_ms, builtin, created_at, updated_at)
      VALUES ('legacy_tools', 'd', 'p', 0, '["read","spawn_subagent"]', NULL, NULL,
              'off', '{}', 30000, 0, 1, 1)
    `).run();

    // The old name may survive in an old row; it must never be handed to a
    // child as an executable name (the child session does not register it).
    expect(getSubagentProfile("legacy_tools")!.tools).toEqual(["read", "subagent"]);
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

  it("allows an empty prompt only when it inherits the parent prompt", async () => {
    const { normalizeSubagentProfileInput, SubagentProfileError } = await import("@/lib/server/subagent-profiles");
    expect(() => normalizeSubagentProfileInput({
      name: "inherits", description: "d", systemPrompt: "", tools: ["read"], inheritSystemPrompt: true,
    })).not.toThrow();
    expect(() => normalizeSubagentProfileInput({
      name: "inherits", description: "d", systemPrompt: "", tools: ["read"], inheritSystemPrompt: false,
    })).toThrow(SubagentProfileError);

    const inherited = normalizeSubagentProfileInput({
      name: "inherits", description: "d", systemPrompt: "fallback", tools: ["read"], inheritSystemPrompt: true,
    });
    expect(inherited.inheritSystemPrompt).toBe(true);
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
    expect(input.inheritSystemPrompt).toBe(false);
    expect(input.thinkingLevel).toBe("off");
    expect(input.timeoutMs).toBeGreaterThan(0);
    expect(input.bot.shapeId).toBeTruthy();
  });
});
