import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSandbox, type Sandbox } from "./sandbox";
import { composeAppendSystemPrompt, composeOverrideSystemPrompt } from "@/lib/server/web-tool-guidance";
import { loadMemoryPromptBlock, resolveMemoryInjectionForSession } from "@/lib/server/memory-injection";
import { readMemoryCwdOverrides, writeMemoryCwdEnabled } from "@/lib/server/memory-cwd-store";
import { MEMORY_GUIDANCE, MEMORY_EMPTY_STATE, MEMORY_INDEX_FILE } from "@/lib/shared/memory-two-tier";

function seedIndex(sandbox: Sandbox, content: string): string {
  const file = join(sandbox.dataDir, "memory", MEMORY_INDEX_FILE);
  mkdirSync(join(sandbox.dataDir, "memory"), { recursive: true });
  writeFileSync(file, content, "utf8");
  return file;
}

function indexPath(sandbox: Sandbox): string {
  return join(sandbox.dataDir, "memory", MEMORY_INDEX_FILE);
}

describe("memory injection: prompt placement", () => {
  it("appends the memory block after user content in default mode", () => {
    const result = composeAppendSystemPrompt({
      mode: "default",
      baseAppend: ["APPEND_SYSTEM user content"],
      sessionBlocks: ["SESSION block"],
      webBlocks: ["WEB block"],
      memoryBlock: "MEMORY block",
    });

    expect(result).toEqual(["APPEND_SYSTEM user content", "SESSION block", "WEB block", "MEMORY block"]);
  });

  it("appends the memory block in prefix mode even though session blocks are dropped", () => {
    const result = composeAppendSystemPrompt({
      mode: "prefix",
      baseAppend: [],
      sessionBlocks: ["SESSION block"],
      webBlocks: ["WEB block"],
      memoryBlock: "MEMORY block",
    });

    expect(result).toEqual(["WEB block", "MEMORY block"]);
  });

  it("appends the memory block after the user override text in override mode", () => {
    expect(composeOverrideSystemPrompt("USER OVERRIDE", ["WEB block"], "MEMORY block")).toBe(
      "USER OVERRIDE\n\nWEB block\n\nMEMORY block",
    );
    expect(composeOverrideSystemPrompt("USER OVERRIDE", [], "MEMORY block")).toBe(
      "USER OVERRIDE\n\nMEMORY block",
    );
  });

  it("leaves composed prompts untouched when there is no memory block", () => {
    expect(
      composeAppendSystemPrompt({
        mode: "default",
        baseAppend: ["APPEND"],
        sessionBlocks: [],
        webBlocks: ["WEB"],
        memoryBlock: null,
      }),
    ).toEqual(["APPEND", "WEB"]);
    expect(composeOverrideSystemPrompt("USER OVERRIDE", [])).toBe("USER OVERRIDE");
  });
});

describe("memory injection: block contents", () => {
  it("injects guidance plus the current index when the index file has content", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    seedIndex(sandbox, "# 记忆索引\n\n- user-profile.md — 用户资料");

    const block = loadMemoryPromptBlock(true)!;

    expect(block).toContain(MEMORY_GUIDANCE);
    expect(block).toContain("## 当前记忆索引");
    expect(block).toContain("- user-profile.md — 用户资料");
    expect(block.indexOf(MEMORY_GUIDANCE)).toBeLessThan(block.indexOf("## 当前记忆索引"));
  });

  it("injects the empty-state guidance when the directory has no index file and creates nothing", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");

    const block = loadMemoryPromptBlock(true);

    expect(block).toContain(MEMORY_GUIDANCE);
    expect(block).toContain(MEMORY_EMPTY_STATE);
    expect(block).not.toContain("## 当前记忆索引");
    expect(existsSync(join(sandbox.dataDir, "memory"))).toBe(false);
  });

  it("treats a blank index file as the empty state", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    seedIndex(sandbox, "   \n  ");

    const block = loadMemoryPromptBlock(true);

    expect(block).toContain(MEMORY_EMPTY_STATE);
    expect(block).not.toContain("## 当前记忆索引");
  });

  it("injects nothing when the switch is off, even with an index on disk", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    seedIndex(sandbox, "# 记忆索引\n\n- user-profile.md — 用户资料");

    expect(loadMemoryPromptBlock(false)).toBeNull();
  });

  it("injects nothing when the index file is unreadable", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    mkdirSync(indexPath(sandbox), { recursive: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(loadMemoryPromptBlock(true)).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps the block captured at session creation unchanged when the index changes later", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    seedIndex(sandbox, "# 记忆索引\n\n- 旧分类.md — 旧说明");

    const captured = loadMemoryPromptBlock(true);
    seedIndex(sandbox, "# 记忆索引\n\n- 新分类.md — 新说明");
    const composed = composeAppendSystemPrompt({
      mode: "default",
      baseAppend: [],
      sessionBlocks: [],
      webBlocks: [],
      memoryBlock: captured,
    });

    expect(loadMemoryPromptBlock(true)).toContain("新分类.md");
    expect(composed.join("\n")).toContain("旧分类.md");
    expect(composed.join("\n")).not.toContain("新分类.md");
  });
});

describe("memory injection: cwd switch decides at session start", () => {
  it("injects when the global switch is on and the cwd is unrecorded", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedIndex(sandbox, "# 记忆索引\n\n- user-profile.md — 用户资料");

    const session = resolveMemoryInjectionForSession("/work/plain", true);

    expect(session.enabled).toBe(true);
    expect(session.block).toContain("- user-profile.md — 用户资料");
  });

  it("injects nothing for a cwd recorded off and leaves the index file untouched", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    const indexFile = seedIndex(sandbox, "# 记忆索引\n\n- user-profile.md — 用户资料");
    writeMemoryCwdEnabled("/work/secret", false);

    const session = resolveMemoryInjectionForSession("/work/secret", true);

    expect(session).toMatchObject({ enabled: false, block: null });
    expect(readFileSync(indexFile, "utf8")).toContain("user-profile.md");
    expect(readMemoryCwdOverrides()).toEqual({ "/work/secret": false });
  });

  it("injects nothing anywhere while the global switch is off", () => {
    createSandbox("pi-work-memory-cwd-session-");

    expect(resolveMemoryInjectionForSession("/work/plain", false)).toMatchObject({ enabled: false, block: null });
  });

  it("cwd off overrides the global switch being on", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedIndex(sandbox, "# 记忆索引");
    writeMemoryCwdEnabled("/work/secret", false);

    expect(resolveMemoryInjectionForSession("/work/secret", true).enabled).toBe(false);
    expect(resolveMemoryInjectionForSession("/work/plain", true).enabled).toBe(true);
  });

  it("restores injection for the next session after turning the cwd back on", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedIndex(sandbox, "# 记忆索引\n\n- user-profile.md — 用户资料");
    writeMemoryCwdEnabled("/work/secret", false);

    expect(resolveMemoryInjectionForSession("/work/secret", true).enabled).toBe(false);

    writeMemoryCwdEnabled("/work/secret", true);

    const session = resolveMemoryInjectionForSession("/work/secret", true);
    expect(session.enabled).toBe(true);
    expect(session.block).toContain("user-profile.md");
  });

  it("keeps memory off and logs a warning when the cwd override file is corrupt", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedIndex(sandbox, "# 记忆索引");
    writeFileSync(join(sandbox.dataDir, "memory-cwd.json"), "{ not json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(resolveMemoryInjectionForSession("/work/plain", true)).toMatchObject({ enabled: false, block: null });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("memory cwd overrides unreadable"));
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps a session created before the switch changed on its captured block", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedIndex(sandbox, "# 记忆索引\n\n- 旧分类.md — 旧说明");

    const existing = resolveMemoryInjectionForSession("/work/plain", true);
    const composed = composeAppendSystemPrompt({
      mode: "default",
      baseAppend: [],
      sessionBlocks: [],
      webBlocks: [],
      memoryBlock: existing.block,
    });

    writeMemoryCwdEnabled("/work/plain", false);

    expect(resolveMemoryInjectionForSession("/work/plain", true)).toMatchObject({ enabled: false, block: null });
    expect(composed.join("\n")).toContain("旧分类.md");
  });
});
