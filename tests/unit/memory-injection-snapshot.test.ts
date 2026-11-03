import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSandbox, type Sandbox } from "./sandbox";
import { resolveMemoryInjectionForSession } from "@/lib/server/memory-injection";
import { readMemoryView, applyMemoryOperations } from "@/lib/server/memory-store";
import { writeMemoryCwdEnabled } from "@/lib/server/memory-cwd-store";
import { MEMORY_TARGET_FILES, type MemoryTarget } from "@/lib/shared/memory";

function seedStore(sandbox: Sandbox, target: MemoryTarget, entries: string[]): void {
  const file = join(sandbox.dataDir, "memory", MEMORY_TARGET_FILES[target]);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, entries.join("\n§\n"), "utf8");
}

function currentHashes(target: MemoryTarget): string[] {
  return readMemoryView(target).entries.map((entry) => entry.hash);
}

describe("session memory snapshot", () => {
  it("derives the snapshot from the same entries the entries route renders", () => {
    const sandbox = createSandbox("pi-work-memory-snapshot-");
    seedStore(sandbox, "memory", ["用户偏好中文", "项目用 pnpm"]);
    seedStore(sandbox, "user", ["用户叫 Al"]);

    const session = resolveMemoryInjectionForSession("/work/plain", true);

    expect(session.block).toContain("用户偏好中文");
    expect(session.snapshot?.memory).toEqual({
      hash: expect.any(String),
      entryCount: 2,
      entryHashes: currentHashes("memory"),
    });
    expect(session.snapshot?.user).toEqual({
      hash: expect.any(String),
      entryCount: 1,
      entryHashes: currentHashes("user"),
    });
  });

  it("is null per library when that library contributed nothing to the block", () => {
    const sandbox = createSandbox("pi-work-memory-snapshot-");
    seedStore(sandbox, "memory", ["用户偏好中文"]);

    const session = resolveMemoryInjectionForSession("/work/plain", true);

    expect(session.snapshot?.memory).not.toBeNull();
    expect(session.snapshot?.user).toBeNull();
  });

  it("is null as a whole when the block is empty", () => {
    const sandbox = createSandbox("pi-work-memory-snapshot-");
    seedStore(sandbox, "memory", ["   "]);
    seedStore(sandbox, "user", []);

    const session = resolveMemoryInjectionForSession("/work/plain", true);

    expect(session.block).toBeNull();
    expect(session.snapshot).toBeNull();
  });

  it("is null when the global switch is off", () => {
    const sandbox = createSandbox("pi-work-memory-snapshot-");
    seedStore(sandbox, "memory", ["用户偏好中文"]);

    expect(resolveMemoryInjectionForSession("/work/plain", false)).toEqual({
      enabled: false,
      block: null,
      snapshot: null,
    });
  });

  it("is null for a cwd recorded off", () => {
    const sandbox = createSandbox("pi-work-memory-snapshot-");
    seedStore(sandbox, "memory", ["用户偏好中文"]);
    writeMemoryCwdEnabled("/work/secret", false);

    expect(resolveMemoryInjectionForSession("/work/secret", true)).toEqual({
      enabled: false,
      block: null,
      snapshot: null,
    });
  });

  it("is null when a store file cannot be read", () => {
    const sandbox = createSandbox("pi-work-memory-snapshot-");
    mkdirSync(join(sandbox.dataDir, "memory", MEMORY_TARGET_FILES.memory), { recursive: true });

    const session = resolveMemoryInjectionForSession("/work/plain", true);

    expect(session.block).toBeNull();
    expect(session.snapshot).toBeNull();
  });

  it("stays frozen when the file changes after the session captured it", async () => {
    const sandbox = createSandbox("pi-work-memory-snapshot-");
    seedStore(sandbox, "memory", ["旧事实"]);

    const session = resolveMemoryInjectionForSession("/work/plain", true);

    await applyMemoryOperations("memory", [{ action: "add", content: "新事实" }]);

    expect(session.block).not.toContain("新事实");
    expect(currentHashes("memory")).not.toEqual(session.snapshot?.memory?.entryHashes);
  });
});
