import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSandbox, type Sandbox } from "./sandbox";
import { agentToolDenylist } from "@/lib/server/agent-tool-denylist";
import { loadMemoryPromptBlock } from "@/lib/server/memory-injection";
import { memoryTool } from "@/lib/server/memory-tool";
import { readSessionToolSelection, writeSessionToolSelection } from "@/lib/server/session-tools-config";
import { restrictSubagentTools, subagentChildSessionStartOptions } from "@/lib/server/subagent-restore";
import type { SubagentTaskConfigSnapshot } from "@/lib/shared/subagent";
import { MEMORY_TOOL_NAME } from "@/lib/shared/memory-tool-types";
import {
  buildToolChecklistRows,
  declarableToolNames,
  expandToolSelection,
  isToolChecklistRowChecked,
  toggleSelectionEntry,
} from "@/lib/shared/tool-selection";

const CATALOG = [
  { name: memoryTool.name, description: memoryTool.description },
  { name: "read", description: "Read a file" },
  { name: "bash", description: "Run a command" },
];

const ALL_NAMES = CATALOG.map((tool) => tool.name);

const rows = buildToolChecklistRows(CATALOG, (count) => `${count} tools`);

function rowOf(name: string) {
  const row = rows.find((entry) => entry.name === name);
  if (!row) throw new Error(`missing checklist row: ${name}`);
  return row;
}

function seedMemory(sandbox: Sandbox, entries: string[]): void {
  const file = join(sandbox.dataDir, "memory", "MEMORY.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, entries.join("\n§\n"), "utf8");
}

describe("memory in the tool catalog", () => {
  it("lists memory under its own name with the description from its definition", () => {
    expect(memoryTool.name).toBe(MEMORY_TOOL_NAME);
    expect(memoryTool.name).toBe("memory");

    expect(rowOf("memory")).toEqual({
      key: "memory",
      name: "memory",
      group: null,
      memberCount: 0,
      description: memoryTool.description,
    });
    expect(rowOf("memory").description).toContain("cross-session memory");
  });

  it("stays declarable so all three pickers can offer it", () => {
    expect(declarableToolNames([memoryTool])).toEqual(["memory"]);
    expect(declarableToolNames(CATALOG)).toEqual(ALL_NAMES);
  });

  it("is never hard-excluded by the platform denylist", () => {
    expect(agentToolDenylist(process.platform)).not.toContain("memory");
  });
});

describe("memory in a session tool set", () => {
  it("is checked when the session runs all tools", () => {
    expect(isToolChecklistRowChecked(rowOf("memory"), new Set(ALL_NAMES), ALL_NAMES)).toBe(true);
  });

  it("unchecks and re-checks without touching the other tools", () => {
    const before = ["read", "bash"];

    const checked = toggleSelectionEntry(before, "memory", true, ALL_NAMES);
    expect(checked).toEqual(["read", "bash", "memory"]);
    expect(isToolChecklistRowChecked(rowOf("memory"), new Set(checked), ALL_NAMES)).toBe(true);

    const unchecked = toggleSelectionEntry(checked, "memory", false, ALL_NAMES);
    expect(unchecked).toEqual(before);
    expect(isToolChecklistRowChecked(rowOf("memory"), new Set(unchecked), ALL_NAMES)).toBe(false);
  });

  it("leaves memory inactive once it is unchecked", () => {
    const declarable = new Set(declarableToolNames(CATALOG));
    const active = (expandToolSelection(["read", "bash"], ALL_NAMES) as string[]).filter((name) =>
      declarable.has(name),
    );

    expect(active).toEqual(["read", "bash"]);
    expect(
      (expandToolSelection(["read", "memory"], ALL_NAMES) as string[]).filter((name) => declarable.has(name)),
    ).toEqual(["read", "memory"]);
  });
});

describe("memory in the session sidecar", () => {
  it("keeps a selection without memory and injects the memory block anyway", () => {
    const sandbox = createSandbox("pi-work-memory-selection-");
    seedMemory(sandbox, ["用户偏好中文"]);

    expect(writeSessionToolSelection("memory-selection-0001", ["read", "bash"])).toBe(true);
    expect(readSessionToolSelection("memory-selection-0001")).toEqual(["read", "bash"]);

    expect(loadMemoryPromptBlock(true)).toContain("用户偏好中文");
  });

  it("stores memory as an ordinary member of the selection", () => {
    createSandbox("pi-work-memory-selection-");

    expect(writeSessionToolSelection("memory-selection-0002", ["read", "memory"])).toBe(true);
    expect(readSessionToolSelection("memory-selection-0002")).toEqual(["read", "memory"]);
  });
});

describe("memory in a subagent profile tool set", () => {
  const config: SubagentTaskConfigSnapshot = {
    subagentName: "implementer",
    cwd: "/tmp/project",
    model: { provider: "anthropic", modelId: "claude" },
    thinkingLevel: "off",
    permissionMode: "auto_deny",
    tools: ["read", "memory"],
    systemPrompt: { kind: "prefix", text: "You are a subagent." },
    timeoutMs: 60_000,
  };

  it("survives the narrowing that only strips the subagent tool itself", () => {
    expect(restrictSubagentTools(["read", "memory", "subagent"])).toEqual(["read", "memory"]);
  });

  it("reaches the child session as an allowed tool", () => {
    expect(subagentChildSessionStartOptions(config, "parent-session-0001").allowedToolNames).toEqual([
      "read",
      "memory",
    ]);
  });
});

describe("memory in the cwd default tool set", () => {
  it("stores and reads back memory", async () => {
    const sandbox = createSandbox("pi-work-memory-cwd-tools-");
    vi.resetModules();
    const { readCwdToolSelection, writeCwdToolSelection } = await import("@/lib/server/cwd-tools-config");
    const cwd = join(sandbox.root, "project");
    mkdirSync(cwd, { recursive: true });

    expect(writeCwdToolSelection(cwd, ["read", "memory"])).toEqual(["read", "memory"]);
    expect(readCwdToolSelection(cwd)).toEqual(["read", "memory"]);
  });
});
