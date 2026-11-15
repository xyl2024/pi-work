import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runMemoryMigration } from "@/lib/server/memory-migration";

function newMemoryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "memory-migration-"));
  mkdirSync(join(dir, "memory"), { recursive: true });
  return join(dir, "memory");
}

const MEMORY_RAW = [
  "喜欢简洁的回答",
  "§",
  "项目部署在 WSL2",
].join("\n");

const USER_RAW = "用户名是 alone";

describe("runMemoryMigration", () => {
  it("converts legacy entries to detail files plus index and archives originals", () => {
    const dir = newMemoryDir();
    writeFileSync(join(dir, "MEMORY.md"), MEMORY_RAW);
    writeFileSync(join(dir, "USER.md"), USER_RAW);

    runMemoryMigration(dir);

    expect(readFileSync(join(dir, "agent-notes.md"), "utf8")).toBe(
      "喜欢简洁的回答\n\n项目部署在 WSL2",
    );
    expect(readFileSync(join(dir, "user-profile.md"), "utf8")).toBe(USER_RAW);
    const index = readFileSync(join(dir, "INDEX.md"), "utf8");
    expect(index).toContain("- agent-notes.md — Agent 笔记（自旧 MEMORY.md 迁移）");
    expect(index).toContain("- user-profile.md — 用户资料（自旧 USER.md 迁移）");
    expect(readFileSync(join(dir, "MEMORY.md.bak"), "utf8")).toBe(MEMORY_RAW);
    expect(readFileSync(join(dir, "USER.md.bak"), "utf8")).toBe(USER_RAW);
    expect(existsSync(join(dir, "MEMORY.md"))).toBe(false);
    expect(existsSync(join(dir, "USER.md"))).toBe(false);
  });

  it("is idempotent: re-running with only new structure or archives does nothing", () => {
    const dir = newMemoryDir();
    writeFileSync(join(dir, "MEMORY.md"), MEMORY_RAW);
    writeFileSync(join(dir, "USER.md"), USER_RAW);
    runMemoryMigration(dir);
    const after = readdirSync(dir).sort();

    runMemoryMigration(dir);
    runMemoryMigration(join(tmpdir(), "memory-migration-nonexistent"));

    expect(readdirSync(dir).sort()).toEqual(after);
  });

  it("archives legacy files even when they contain no entries", () => {
    const dir = newMemoryDir();
    writeFileSync(join(dir, "MEMORY.md"), "   ");
    writeFileSync(join(dir, "USER.md"), USER_RAW);

    runMemoryMigration(dir);

    expect(existsSync(join(dir, "MEMORY.md.bak"))).toBe(true);
    expect(existsSync(join(dir, "USER.md.bak"))).toBe(true);
    expect(existsSync(join(dir, "agent-notes.md"))).toBe(false);
    expect(readFileSync(join(dir, "user-profile.md"), "utf8")).toBe(USER_RAW);
    expect(existsSync(join(dir, "INDEX.md"))).toBe(true);
  });

  it("does nothing when the directory only has the new structure", () => {
    const dir = newMemoryDir();
    writeFileSync(join(dir, "INDEX.md"), "# 记忆索引");
    writeFileSync(join(dir, "user-profile.md"), "已有明细");

    runMemoryMigration(dir);

    expect(readdirSync(dir).sort()).toEqual(["INDEX.md", "user-profile.md"]);
  });
});
