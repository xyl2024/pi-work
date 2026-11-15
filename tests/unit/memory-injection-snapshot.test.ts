import { describe, expect, it } from "vitest";
import { createSandbox } from "./sandbox";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveMemoryInjectionForSession } from "@/lib/server/memory-injection";
import { writeMemoryCwdEnabled } from "@/lib/server/memory-cwd-store";
import { MEMORY_INDEX_FILE } from "@/lib/shared/memory-two-tier";

function seedIndex(sandbox: ReturnType<typeof createSandbox>, content: string): void {
  mkdirSync(join(sandbox.dataDir, "memory"), { recursive: true });
  writeFileSync(join(sandbox.dataDir, "memory", MEMORY_INDEX_FILE), content, "utf8");
}

describe("session memory snapshot", () => {
  it("stays null during assembly now that injection reads the index instead of the libraries", () => {
    const sandbox = createSandbox("pi-work-memory-snapshot-");
    seedIndex(sandbox, "# 记忆索引\n\n- user-profile.md — 用户资料");

    const session = resolveMemoryInjectionForSession("/work/plain", true);

    expect(session.enabled).toBe(true);
    expect(session.block).toContain("user-profile.md");
    expect(session.snapshot).toBeNull();
  });

  it("is null together with the block when the global switch is off", () => {
    createSandbox("pi-work-memory-snapshot-");

    expect(resolveMemoryInjectionForSession("/work/plain", false)).toEqual({
      enabled: false,
      block: null,
      snapshot: null,
    });
  });

  it("is null together with the block when the cwd is recorded off", () => {
    const sandbox = createSandbox("pi-work-memory-snapshot-");
    seedIndex(sandbox, "# 记忆索引");
    writeMemoryCwdEnabled("/work/secret", false);

    expect(resolveMemoryInjectionForSession("/work/secret", true)).toEqual({
      enabled: false,
      block: null,
      snapshot: null,
    });
  });
});
