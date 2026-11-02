import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSandbox, type Sandbox } from "./sandbox";
import { composeAppendSystemPrompt, composeOverrideSystemPrompt } from "@/lib/server/web-tool-guidance";
import { loadMemoryPromptBlock, resolveMemoryForSession } from "@/lib/server/memory-injection";
import { readMemoryCwdOverrides, writeMemoryCwdEnabled } from "@/lib/server/memory-cwd-store";
import { applyMemoryOperations } from "@/lib/server/memory-store";
import type { MemoryTarget } from "@/lib/shared/memory";

const STORE_FILE: Record<MemoryTarget, string> = {
  memory: "MEMORY.md",
  user: "USER.md",
};

function seedStore(sandbox: Sandbox, target: MemoryTarget, entries: string[]): void {
  const file = join(sandbox.dataDir, "memory", STORE_FILE[target]);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, entries.join("\n§\n"), "utf8");
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
  it("renders both libraries with separators, titles, usage and §-joined entries", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    seedStore(sandbox, "memory", ["x".repeat(506)]);
    seedStore(sandbox, "user", ["用户偏好中文", "回复要简短"]);

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
    seedStore(sandbox, "user", ["用户叫 Al"]);

    const text = loadMemoryPromptBlock(true);

    expect(text).toContain("USER PROFILE (who the user is)");
    expect(text).not.toContain("MEMORY (your personal notes)");
  });

  it("does not read the memory files when the switch is off", () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    const blocked = join(sandbox.dataDir, "memory");
    mkdirSync(dirname(blocked), { recursive: true });
    writeFileSync(blocked, "not a directory", "utf8");

    expect(loadMemoryPromptBlock(false)).toBeNull();
  });

  it("keeps a captured block unchanged when a later write lands on disk", async () => {
    const sandbox = createSandbox("pi-work-memory-injection-");
    seedStore(sandbox, "memory", ["旧事实"]);

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
    seedStore(sandbox, "memory", ["用户偏好中文"]);

    const session = resolveMemoryForSession("/work/plain", true);

    expect(session.enabled).toBe(true);
    expect(session.block).toContain("用户偏好中文");
  });

  it("injects nothing for a cwd recorded off and leaves the files untouched", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedStore(sandbox, "memory", ["用户偏好中文"]);
    seedStore(sandbox, "user", ["用户叫 Al"]);
    writeMemoryCwdEnabled("/work/secret", false);
    const memoryFile = join(sandbox.dataDir, "memory", "MEMORY.md");

    const session = resolveMemoryForSession("/work/secret", true);

    expect(session).toEqual({ enabled: false, block: null });
    expect(readFileSync(memoryFile, "utf8")).toBe("用户偏好中文");
    expect(readMemoryCwdOverrides()).toEqual({ "/work/secret": false });
  });

  it("injects nothing anywhere while the global switch is off", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedStore(sandbox, "memory", ["用户偏好中文"]);

    expect(resolveMemoryForSession("/work/plain", false)).toEqual({ enabled: false, block: null });
  });

  it("restores injection and the tool for the next session after turning the cwd back on", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedStore(sandbox, "memory", ["用户偏好中文"]);
    writeMemoryCwdEnabled("/work/secret", false);

    expect(resolveMemoryForSession("/work/secret", true).enabled).toBe(false);

    writeMemoryCwdEnabled("/work/secret", true);

    const session = resolveMemoryForSession("/work/secret", true);
    expect(session.enabled).toBe(true);
    expect(session.block).toContain("用户偏好中文");
  });

  it("keeps a session created before the switch changed on its captured snapshot", () => {
    const sandbox = createSandbox("pi-work-memory-cwd-session-");
    seedStore(sandbox, "memory", ["旧事实"]);

    const existing = resolveMemoryForSession("/work/plain", true);
    const composed = composeAppendSystemPrompt({
      mode: "default",
      baseAppend: [],
      sessionBlocks: [],
      webBlocks: [],
      memoryBlock: existing.block,
    });

    writeMemoryCwdEnabled("/work/plain", false);

    expect(resolveMemoryForSession("/work/plain", true)).toEqual({ enabled: false, block: null });
    expect(composed.join("\n")).toContain("旧事实");
  });
});
