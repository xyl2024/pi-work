import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSandbox, seedMemoryLibrary } from "./sandbox";
import { composeAppendSystemPrompt, composeOverrideSystemPrompt } from "@/lib/server/web-tool-guidance";
import { loadMemoryPromptBlock, resolveMemoryInjectionForSession } from "@/lib/server/memory-injection";
import { readMemoryCwdOverrides, writeMemoryCwdEnabled } from "@/lib/server/memory-cwd-store";
import { applyMemoryOperations } from "@/lib/server/memory-store";

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
  it("renders both libraries with separators, titles, usage and §-joined entries", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    seedMemoryLibrary(sandbox, "memory", ["x".repeat(506)]);
    seedMemoryLibrary(sandbox, "user", ["用户偏好中文", "回复要简短"]);

    const block = loadMemoryPromptBlock(true);

    expect(block).not.toBeNull();
    const text = block!;
    const rule = "═".repeat(46);
    expect(text).toContain(rule);
    expect(text).toContain("MEMORY (your personal notes) [23% — 506/2,200 chars]");
    expect(text).toContain("USER PROFILE (who the user is) [1% — 14/1,375 chars]");
    expect(text).toContain(`用户偏好中文\n§\n回复要简短`);
    expect(text.indexOf("MEMORY (your personal notes)")).toBeLessThan(
      text.indexOf("USER PROFILE (who the user is)"),
    );
  });

  it("injects nothing when both libraries are empty", () => {
    createSandbox("pi-work-memory-injection-");

    expect(loadMemoryPromptBlock(true)).toBeNull();
  });

  it("injects only the library that has entries", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    seedMemoryLibrary(sandbox, "user", ["用户叫 Al"]);

    const text = loadMemoryPromptBlock(true);

    expect(text).toContain("USER PROFILE (who the user is)");
    expect(text).not.toContain("MEMORY (your personal notes)");
  });

  it("does not read the memory files when the switch is off", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    writeFileSync(join(sandbox.dataDir, "memory"), "not a directory", "utf8");

    expect(loadMemoryPromptBlock(false)).toBeNull();
  });

  it("keeps a captured block unchanged when a later write lands on disk", async () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    seedMemoryLibrary(sandbox, "memory", ["旧事实"]);

    const captured = loadMemoryPromptBlock(true);
    const composed = composeAppendSystemPrompt({
      mode: "default",
      baseAppend: [],
      sessionBlocks: [],
      webBlocks: [],
      memoryBlock: captured,
    });

    await applyMemoryOperations("memory", [{ action: "add", content: "新事实" }]);

    expect(loadMemoryPromptBlock(true)).toContain("新事实");
    expect(composed.join("\n")).toContain("旧事实");
    expect(composed.join("\n")).not.toContain("新事实");
  });
});

describe("memory injection: cwd switch decides at session start", () => {
  it("injects when the global switch is on and the cwd is unrecorded", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedMemoryLibrary(sandbox, "memory", ["用户偏好中文"]);

    const session = resolveMemoryInjectionForSession("/work/plain", true);

    expect(session.enabled).toBe(true);
    expect(session.block).toContain("用户偏好中文");
  });

  it("injects nothing for a cwd recorded off and leaves the files untouched", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedMemoryLibrary(sandbox, "memory", ["用户偏好中文"]);
    seedMemoryLibrary(sandbox, "user", ["用户叫 Al"]);
    writeMemoryCwdEnabled("/work/secret", false);
    const memoryFile = join(sandbox.dataDir, "memory", "MEMORY.md");

    const session = resolveMemoryInjectionForSession("/work/secret", true);

    expect(session).toMatchObject({ enabled: false, block: null });
    expect(readFileSync(memoryFile, "utf8")).toBe("用户偏好中文");
    expect(readMemoryCwdOverrides()).toEqual({ "/work/secret": false });
  });

  it("injects nothing anywhere while the global switch is off", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedMemoryLibrary(sandbox, "memory", ["用户偏好中文"]);

    expect(resolveMemoryInjectionForSession("/work/plain", false)).toMatchObject({ enabled: false, block: null });
  });

  it("restores injection and the tool for the next session after turning the cwd back on", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedMemoryLibrary(sandbox, "memory", ["用户偏好中文"]);
    writeMemoryCwdEnabled("/work/secret", false);

    expect(resolveMemoryInjectionForSession("/work/secret", true).enabled).toBe(false);

    writeMemoryCwdEnabled("/work/secret", true);

    const session = resolveMemoryInjectionForSession("/work/secret", true);
    expect(session.enabled).toBe(true);
    expect(session.block).toContain("用户偏好中文");
  });

  it("keeps memory off and logs a warning when the cwd override file is corrupt", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedMemoryLibrary(sandbox, "memory", ["用户偏好中文"]);
    writeFileSync(join(sandbox.dataDir, "memory-cwd.json"), "{ not json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(resolveMemoryInjectionForSession("/work/plain", true)).toMatchObject({ enabled: false, block: null });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("memory cwd overrides unreadable"));
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps a session created before the switch changed on its captured snapshot", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedMemoryLibrary(sandbox, "memory", ["旧事实"]);

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
    expect(composed.join("\n")).toContain("旧事实");
  });
});
