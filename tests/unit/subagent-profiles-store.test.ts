import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let dbPath: string;

function resetStoreGlobals(): void {
  delete (globalThis as { __piSubagentsDb?: unknown }).__piSubagentsDb;
  delete (globalThis as { __piSubagentProfilesSeeded?: unknown }).__piSubagentProfilesSeeded;
}

function writeProfilesDb(
  path: string,
  version: number,
  rows: ReadonlyArray<{ name: string; description?: string }>,
): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE subagent_profiles (
      name           TEXT PRIMARY KEY,
      description    TEXT NOT NULL,
      system_prompt  TEXT NOT NULL,
      inherit_system_prompt INTEGER NOT NULL DEFAULT 0,
      tools          TEXT NOT NULL,
      model_provider TEXT,
      model_id       TEXT,
      thinking_level TEXT NOT NULL,
      permission_mode TEXT,
      bot            TEXT NOT NULL,
      timeout_ms     INTEGER NOT NULL,
      builtin        INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO subagent_profiles
      (name, description, system_prompt, inherit_system_prompt, tools, model_provider, model_id,
       thinking_level, permission_mode, bot, timeout_ms, builtin, created_at, updated_at)
    VALUES (?, ?, ?, 0, '["read"]', NULL, NULL, 'off', 'auto_deny', '{}', 30000, 1, 1, 1)
  `);
  for (const row of rows) insert.run(row.name, row.description ?? "seed", `${row.name} prompt`);
  db.pragma(`user_version = ${version}`);
  db.close();
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
      "code_reviewer", "codebase_explorer", "implementer", "web_searcher",
    ]);
    for (const profile of profiles) {
      expect(profile.builtin).toBe(true);
      if (!profile.inheritSystemPrompt) expect(profile.systemPrompt.length).toBeGreaterThan(0);
      expect(profile.tools).toContain("read");
      expect(profile.bot.shapeId).toBeTruthy();
      expect(profile.timeoutMs).toBeGreaterThanOrEqual(10_000);
      expect(profile.permissionMode).toBe("auto_deny");
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

  it("seeds web_searcher with its own web tool set and a sourced reporting prompt", async () => {
    const { BUILTIN_SUBAGENT_SEEDS } = await import("@/lib/server/subagent-profiles");
    const { subagentTools } = await import("@/lib/server/subagent-tools");
    const seed = BUILTIN_SUBAGENT_SEEDS.find((profile) => profile.name === "web_searcher");
    expect(seed).toBeDefined();
    expect(seed!.tools).toEqual(["web_search", "web_fetch", "bash", "read", "write", "edit"]);
    expect(seed!.permissionMode).toBe("auto_deny");
    expect(seed!.model).toBeNull();
    expect(seed!.thinkingLevel).toBe("off");
    expect(seed!.tools).not.toEqual(subagentTools(process.platform));
    expect(subagentTools(process.platform)).not.toContain("write");
    expect(subagentTools(process.platform)).not.toContain("edit");

    const prompt = seed!.systemPrompt.toLowerCase();
    expect(prompt).toContain("search");
    expect(prompt).toContain("fetch");
    expect(prompt).toContain("report");
    expect(prompt).toContain("source link");
    expect(prompt).toContain("fact");
    expect(prompt).toContain("inference");
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

    const { getSubagentDb } = await import("@/lib/server/subagent-store");
    const upgraded = listSubagentProfiles();
    expect(upgraded.map((profile) => profile.name).sort()).toEqual([
      "codebase_explorer", "implementer", "web_searcher",
    ]);
    expect(upgraded.find((profile) => profile.name === "codebase_explorer")?.permissionMode).toBe("auto_deny");
    const implementer = upgraded.find((profile) => profile.name === "implementer");
    expect(implementer?.inheritSystemPrompt).toBe(true);
    expect(implementer?.tools).toEqual(["read", "edit", "write", "bash", "codemode"]);
    expect(implementer?.permissionMode).toBe("auto_deny");
    const columns = (getSubagentDb().prepare("PRAGMA table_info(subagent_profiles)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    expect(columns).toContain("permission_mode");

    expect(deleteSubagentProfile("implementer")).toBe(true);
    resetStoreGlobals();
    const reloaded = (await import("@/lib/server/subagent-profiles")).listSubagentProfiles();
    expect(reloaded.map((profile) => profile.name)).not.toContain("implementer");

    process.env.PI_WORK_SUBAGENTS_DB = dbPath;
    resetStoreGlobals();
  });

  it("adds only web_searcher when upgrading a version 1 database", async () => {
    const upgradePath = join(dir, "v1-upgrade.db");
    writeProfilesDb(upgradePath, 1, [
      { name: "codebase_explorer" }, { name: "code_reviewer" }, { name: "implementer" },
    ]);

    process.env.PI_WORK_SUBAGENTS_DB = upgradePath;
    resetStoreGlobals();
    const { listSubagentProfiles } = await import("@/lib/server/subagent-profiles");
    const { getSubagentDb } = await import("@/lib/server/subagent-store");

    const names = listSubagentProfiles().map((profile) => profile.name).sort();
    expect(names).toEqual(["code_reviewer", "codebase_explorer", "implementer", "web_searcher"]);
    expect(getSubagentDb().pragma("user_version", { simple: true })).toBe(2);

    process.env.PI_WORK_SUBAGENTS_DB = dbPath;
    resetStoreGlobals();
  });

  it("keeps user-edited built-ins when upgrading to version 2", async () => {
    const upgradePath = join(dir, "v1-custom.db");
    writeProfilesDb(upgradePath, 1, [
      { name: "codebase_explorer", description: "mine" },
      { name: "implementer", description: "my implementer" },
    ]);

    process.env.PI_WORK_SUBAGENTS_DB = upgradePath;
    resetStoreGlobals();
    const { listSubagentProfiles } = await import("@/lib/server/subagent-profiles");
    const profiles = listSubagentProfiles();
    expect(profiles.map((profile) => profile.name).sort()).toEqual([
      "codebase_explorer", "implementer", "web_searcher",
    ]);
    expect(profiles.find((profile) => profile.name === "codebase_explorer")?.description).toBe("mine");
    expect(profiles.find((profile) => profile.name === "implementer")?.description).toBe("my implementer");

    process.env.PI_WORK_SUBAGENTS_DB = dbPath;
    resetStoreGlobals();
  });

  it("keeps a deleted web_searcher deleted after upgrading", async () => {
    const upgradePath = join(dir, "v1-deleted.db");
    writeProfilesDb(upgradePath, 1, [
      { name: "codebase_explorer" }, { name: "code_reviewer" }, { name: "implementer" },
    ]);

    process.env.PI_WORK_SUBAGENTS_DB = upgradePath;
    resetStoreGlobals();
    const { deleteSubagentProfile, listSubagentProfiles } = await import("@/lib/server/subagent-profiles");
    expect(listSubagentProfiles().map((profile) => profile.name)).toContain("web_searcher");
    expect(deleteSubagentProfile("web_searcher")).toBe(true);

    resetStoreGlobals();
    const reloaded = listSubagentProfiles();
    expect(reloaded.map((profile) => profile.name)).not.toContain("web_searcher");

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
      permissionMode: "full_access",
      bot: { expression: 3, stateKey: "writing", shapeId: "cloud", parts: ["hands"], accessories: [] },
      timeoutMs: 60_000,
    });
    expect(created.builtin).toBe(false);
    expect(created.model).toEqual({ provider: "anthropic", modelId: "claude" });
    expect(created.permissionMode).toBe("full_access");

    const updated = updateSubagentProfile({ ...created, description: "Updated.", tools: ["read"], permissionMode: "auto_deny" });
    expect(updated.description).toBe("Updated.");
    expect(updated.tools).toEqual(["read"]);
    expect(updated.permissionMode).toBe("auto_deny");
    expect(getSubagentProfile("docs_writer")?.permissionMode).toBe("auto_deny");
    expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);

    expect(getSubagentProfile("docs_writer")).not.toBeNull();
    expect(deleteSubagentProfile("docs_writer")).toBe(true);
    expect(getSubagentProfile("docs_writer")).toBeNull();
    expect(deleteSubagentProfile("docs_writer")).toBe(false);
  });

  it("lets a built-in profile's permission mode be edited", async () => {
    resetStoreGlobals();
    const { getSubagentProfile, updateSubagentProfile } = await import("@/lib/server/subagent-profiles");
    const explorer = getSubagentProfile("codebase_explorer")!;
    expect(explorer.permissionMode).toBe("auto_deny");
    const updated = updateSubagentProfile({ ...explorer, permissionMode: "full_access" });
    expect(updated.builtin).toBe(true);
    expect(updated.permissionMode).toBe("full_access");
    expect(getSubagentProfile("codebase_explorer")?.permissionMode).toBe("full_access");
    updateSubagentProfile({ ...explorer, permissionMode: "auto_deny" });
  });

  it("reads NULL, empty and unknown stored permission modes as auto deny", async () => {
    resetStoreGlobals();
    const { getSubagentDb } = await import("@/lib/server/subagent-store");
    const { getSubagentProfile, listSubagentProfiles } = await import("@/lib/server/subagent-profiles");
    listSubagentProfiles();
    const insert = getSubagentDb().prepare(`
      INSERT INTO subagent_profiles
        (name, description, system_prompt, inherit_system_prompt, tools, model_provider, model_id,
         thinking_level, permission_mode, bot, timeout_ms, builtin, created_at, updated_at)
      VALUES (?, 'd', 'p', 0, '["read"]', NULL, NULL, 'off', ?, '{}', 30000, 0, 1, 1)
    `);
    for (const [name, mode] of [["legacy_null_mode", null], ["legacy_empty_mode", ""], ["legacy_unknown_mode", "confirm"]] as const) {
      insert.run(name, mode);
      expect(getSubagentProfile(name)?.permissionMode).toBe("auto_deny");
    }
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
        -- request_id is already part of the schema this legacy fixture models;
        -- this test is about the subagent_type -> subagent_name rename.
        request_id TEXT,
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

    process.env.PI_WORK_SUBAGENTS_DB = dbPath;
    resetStoreGlobals();
  });
});

describe("profile tool-name migration", () => {
  it("migrates a stored pre-rename tool name on load", async () => {
    resetStoreGlobals();
    const { getSubagentDb } = await import("@/lib/server/subagent-store");
    const { getSubagentProfile, listSubagentProfiles } = await import("@/lib/server/subagent-profiles");
    listSubagentProfiles();
    getSubagentDb().prepare(`
      INSERT INTO subagent_profiles
        (name, description, system_prompt, inherit_system_prompt, tools, model_provider, model_id,
         thinking_level, bot, timeout_ms, builtin, created_at, updated_at)
      VALUES ('legacy_tools', 'd', 'p', 0, '["read","spawn_subagent"]', NULL, NULL,
              'off', '{}', 30000, 0, 1, 1)
    `).run();

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
    expect(input.permissionMode).toBe("auto_deny");
    expect(input.timeoutMs).toBeGreaterThan(0);
    expect(input.bot.shapeId).toBeTruthy();
  });

  it("round-trips the background permission mode and rejects unknown values", async () => {
    const { normalizeSubagentProfileInput, SubagentProfileError } = await import("@/lib/server/subagent-profiles");
    const base = { name: "modes", description: "d", systemPrompt: "p", tools: ["read"] };
    expect(normalizeSubagentProfileInput({ ...base, permissionMode: "full_access" }).permissionMode).toBe("full_access");
    expect(normalizeSubagentProfileInput({ ...base, permissionMode: "auto_deny" }).permissionMode).toBe("auto_deny");
    for (const permissionMode of ["confirm", "yolo", ""]) {
      expect(() => normalizeSubagentProfileInput({ ...base, permissionMode })).toThrow(SubagentProfileError);
    }
  });
});
