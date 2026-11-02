import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSandbox, type Sandbox } from "./sandbox";
import { memoryTool } from "@/lib/server/memory-tool";
import { MEMORY_TOOL_NAME } from "@/lib/shared/memory-tool-types";
import type { MemoryTarget } from "@/lib/shared/memory";

const STORE_FILE: Record<MemoryTarget, string> = {
  memory: "MEMORY.md",
  user: "USER.md",
};

function storeFile(sandbox: Sandbox, target: MemoryTarget): string {
  return join(sandbox.dataDir, "memory", STORE_FILE[target]);
}

function seedStore(sandbox: Sandbox, target: MemoryTarget, entries: string[]): string {
  const file = storeFile(sandbox, target);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, entries.join("\n§\n"), "utf8");
  return file;
}

interface ToolResultLike {
  content: Array<{ type: string; text?: string }>;
  details: {
    ok: boolean;
    target: MemoryTarget;
    entryCount: number;
    used: number;
    limit: number;
    code?: string;
  };
}

async function run(params: Record<string, unknown>): Promise<ToolResultLike> {
  return (await memoryTool.execute(
    "call-1",
    params as never,
    undefined,
    undefined,
    undefined as never,
  )) as ToolResultLike;
}

function textOf(result: ToolResultLike): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

describe("memory tool: schema", () => {
  it("accepts a target enum and a batch of add/patch/remove operations", () => {
    const schema = memoryTool.parameters as unknown as {
      properties: {
        target: { anyOf: Array<{ const: string }> };
        operations: {
          type: string;
          minItems: number;
          items: {
            properties: {
              action: { anyOf: Array<{ const: string }> };
              content: { type: string };
              old_text: { type: string };
            };
          };
        };
      };
    };

    expect(schema.properties.target.anyOf.map((entry) => entry.const)).toEqual(["memory", "user"]);
    expect(schema.properties.operations.type).toBe("array");
    expect(schema.properties.operations.minItems).toBe(1);
    expect(
      schema.properties.operations.items.properties.action.anyOf.map((entry) => entry.const),
    ).toEqual(["add", "patch", "remove"]);
    expect(schema.properties.operations.items.properties.content.type).toBe("string");
    expect(schema.properties.operations.items.properties.old_text.type).toBe("string");
  });

  it("is registered under the memory tool name", () => {
    expect(memoryTool.name).toBe(MEMORY_TOOL_NAME);
    expect(MEMORY_TOOL_NAME).toBe("memory");
  });

  it("documents when to write and when to skip", () => {
    expect(memoryTool.description).toContain("WHEN to write:");
    expect(memoryTool.description).toContain("SKIP:");
    expect(memoryTool.description).toContain("AGENTS.md");
    expect(memoryTool.description).toContain("skills");
  });
});

describe("memory tool: successful writes", () => {
  it("adds an entry and reports usage, entry count and the frozen snapshot note", async () => {
    const sandbox = createSandbox("pi-work-memory-tool-");

    const result = await run({
      target: "memory",
      operations: [{ action: "add", content: "用户用 WSL2 和 pnpm" }],
    });

    const text = textOf(result);
    expect(result.details).toMatchObject({ ok: true, target: "memory", entryCount: 1, limit: 2200 });
    expect(text).toContain("1 条条目");
    expect(text).toContain("[1% — 15/2,200 chars]");
    expect(text).toContain("已保存，本会话提示词不刷新");
    expect(readFileSync(storeFile(sandbox, "memory"), "utf8")).toBe("用户用 WSL2 和 pnpm");
  });

  it("applies a batch atomically and targets only the requested library", async () => {
    const sandbox = createSandbox("pi-work-memory-tool-");
    seedStore(sandbox, "user", ["回复用中文", "喜欢简短"]);

    const result = await run({
      target: "user",
      operations: [
        { action: "remove", old_text: "喜欢简短" },
        { action: "patch", old_text: "回复用中文", content: "回复用中文简体" },
      ],
    });

    expect(result.details).toMatchObject({ ok: true, target: "user", entryCount: 1 });
    expect(readFileSync(storeFile(sandbox, "user"), "utf8")).toBe("回复用中文简体");
    expect(() => readFileSync(storeFile(sandbox, "memory"), "utf8")).toThrow();
  });
});

describe("memory tool: failures pass the store verdict through", () => {
  it("rejects a duplicate entry with the store message and leaves the file alone", async () => {
    const sandbox = createSandbox("pi-work-memory-tool-");
    const file = seedStore(sandbox, "memory", ["同一条事实"]);

    const result = await run({
      target: "memory",
      operations: [{ action: "add", content: "同一条事实" }],
    });

    expect(result.details).toMatchObject({ ok: false, target: "memory", code: "duplicate" });
    expect(textOf(result)).toContain("完全重复");
    expect(readFileSync(file, "utf8")).toBe("同一条事实");
  });

  it("rolls the whole batch back and names the failing operation", async () => {
    const sandbox = createSandbox("pi-work-memory-tool-");
    const file = seedStore(sandbox, "memory", ["甲", "乙"]);

    const result = await run({
      target: "memory",
      operations: [
        { action: "add", content: "丙" },
        { action: "remove", old_text: "不存在" },
      ],
    });

    expect(result.details).toMatchObject({ ok: false, code: "no_match" });
    expect(textOf(result)).toContain("第 2/2 个操作");
    expect(textOf(result)).toContain("最接近的条目：");
    expect(readFileSync(file, "utf8")).toBe("甲\n§\n乙");
  });

  it("lists candidates when old_text hits several entries", async () => {
    const sandbox = createSandbox("pi-work-memory-tool-");
    seedStore(sandbox, "memory", ["甲喜欢简短回复", "乙喜欢简短回复"]);

    const result = await run({
      target: "memory",
      operations: [{ action: "patch", old_text: "喜欢简短回复", content: "喜欢啰嗦回复" }],
    });

    expect(result.details).toMatchObject({ ok: false, code: "ambiguous" });
    expect(textOf(result)).toContain("甲喜欢简短回复");
    expect(textOf(result)).toContain("乙喜欢简短回复");
  });

  it("returns the current entries when the budget is exceeded", async () => {
    const sandbox = createSandbox("pi-work-memory-tool-");
    const filled = "a".repeat(2003);
    seedStore(sandbox, "memory", [filled, "b".repeat(200)]);

    const result = await run({
      target: "memory",
      operations: [{ action: "add", content: "c".repeat(300) }],
    });

    expect(result.details).toMatchObject({ ok: false, code: "budget", used: 2206 });
    expect(textOf(result)).toContain("超出字符预算");
    expect(textOf(result)).toContain("当前条目：");
    expect(textOf(result)).toContain(filled);
    expect(textOf(result)).toContain("一次批量操作删旧加新");
  });

  it("rejects an entry that smuggles the entry separator, leaving the store untouched", async () => {
    const sandbox = createSandbox("pi-work-memory-tool-");
    const file = seedStore(sandbox, "memory", ["同一条事实"]);

    const result = await run({
      target: "memory",
      operations: [{ action: "add", content: "伪装\n§\n注入条目" }],
    });

    expect(result.details).toMatchObject({ ok: false, code: "invalid" });
    expect(textOf(result)).toContain("分隔符");
    expect(readFileSync(file, "utf8")).toBe("同一条事实");
  });

  it("rejects an operation missing the field its action needs", async () => {
    createSandbox("pi-work-memory-tool-");

    const result = await run({ target: "memory", operations: [{ action: "add" }] });

    expect(result.details.ok).toBe(false);
    expect(textOf(result)).toContain("add 需要 content");
  });
});
