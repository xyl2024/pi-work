import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSandbox, type Sandbox } from "./sandbox";
import { composeAppendSystemPrompt, composeOverrideSystemPrompt } from "@/lib/server/web-tool-guidance";
import { loadMemoryPromptBlock } from "@/lib/server/memory-injection";
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
