import { describe, expect, it } from "vitest";
import {
  computeContextComposition,
  type ContextBucketId,
  type ContextComposition,
} from "@/lib/shared/context-composition";
import { contextBucketRows, type ContextCompositionRow } from "@/lib/shared/context-composition-rows";

// Pure unit tests for the composition panel's row projection (#37). The seam is
// the same one `context-composition.test.ts` uses: an injected deterministic
// `countTokens`, no tokenizer, no request.
//
// What matters is the *partition*: rows are what the panel prints, so a row's
// number has to equal the leaves it owns and the parent's number, otherwise the
// UI shows an arithmetic discrepancy it cannot explain.

const chars4 = (text: string) => Math.floor(text.length / 4);

function composition(input: {
  systemPrompt?: string | null;
  tools?: Parameters<typeof computeContextComposition>[0]["tools"];
  messages?: Parameters<typeof computeContextComposition>[0]["messages"];
  anchoredTotalTokens?: number | null;
}) {
  return computeContextComposition({
    systemPrompt: input.systemPrompt ?? null,
    tools: input.tools ?? null,
    messages: input.messages ?? null,
    anchoredTotalTokens: input.anchoredTotalTokens ?? null,
    countTokens: chars4,
  });
}

function bucket(result: ContextComposition, id: ContextBucketId) {
  const found = result.buckets.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no bucket ${id}`);
  return found;
}

const sum = (values: Array<number | null>) => values.reduce((total: number, value) => total + (value ?? 0), 0);

/** Every row (including children) must add up to the bucket it came from. */
function expectPartition(
  result: ContextComposition,
  id: ContextBucketId,
  rows: ContextCompositionRow[],
) {
  const source = bucket(result, id);
  expect(sum(rows.map((row) => row.localTokens))).toBe(source.localTokens);
  expect(sum(rows.map((row) => row.tokens))).toBe(source.tokens ?? 0);
  expect(sum(rows.map((row) => row.percent))).toBeCloseTo(source.percent ?? 0, 10);
  for (const row of rows) {
    if (row.children.length === 0) continue;
    expect(sum(row.children.map((child) => child.localTokens))).toBe(row.localTokens);
    expect(sum(row.children.map((child) => child.tokens))).toBe(row.tokens ?? 0);
    expect(sum(row.children.map((child) => child.percent))).toBeCloseTo(row.percent ?? 0, 10);
  }
}

const SYSTEM_PROMPT = `You are an expert coding assistant operating inside pi, a coding agent harness.

Available tools:
- read: Read the contents of a file
- bash: Execute a bash command

Guidelines:
- Be concise in your responses

Pi documentation (read only when the user asks about pi itself):
- Main documentation: /pi/README.md
- Always read pi .md files completely and follow links to related docs

APPENDED SYSTEM PROMPT

<project_context>

Project-specific instructions and guidelines:

<project_instructions path="/repo/AGENTS.md">
# AGENTS.md

Be careful.
</project_instructions>

<project_instructions path="/repo/packages/app/AGENTS.md">
# Package rules
</project_instructions>

</project_context>

The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.

<available_skills>
  <skill>
    <name>demo</name>
    <description>Demo skill</description>
    <location>/skills/demo/SKILL.md</location>
  </skill>
</available_skills>
Current working directory: /repo`;

const MESSAGES = [
  { role: "user", content: [{ type: "text", text: "hello world" }] },
  {
    role: "assistant",
    content: [
      { type: "text", text: "hi there" },
      { type: "thinking", thinking: "let me think" },
      { type: "toolCall", name: "read", arguments: { path: "a.ts" } },
    ],
  },
  { role: "toolResult", content: [{ type: "text", text: "file contents" }] },
];

describe("contextBucketRows", () => {
  it("lists the system-prompt sources in panel order", () => {
    const result = composition({ systemPrompt: SYSTEM_PROMPT, anchoredTotalTokens: 1000 });
    const rows = contextBucketRows(bucket(result, "system-prompt"));

    expect(rows.map((row) => row.id)).toEqual([
      "base",
      "agents:/repo/AGENTS.md",
      "agents:/repo/packages/app/AGENTS.md",
      "pi-docs",
      "append",
      "cwd",
    ]);
    expectPartition(result, "system-prompt", rows);
  });

  it("splits the base prompt row into prose + the two anchored sections", () => {
    const result = composition({ systemPrompt: SYSTEM_PROMPT, anchoredTotalTokens: 1000 });
    const rows = contextBucketRows(bucket(result, "system-prompt"));
    const base = rows.find((row) => row.id === "base")!;

    expect(base.children.map((child) => child.id)).toEqual(["base", "available-tools", "guidelines"]);
    // The tools-list line lives here, under its Context-panel anchor name —
    // never in the `system-tools` bucket (which is ~50× bigger).
    expect(base.children.find((child) => child.id === "available-tools")!.localTokens).toBeGreaterThan(0);
    expectPartition(result, "system-prompt", rows);
  });

  it("does not offer a second level when the base prompt is a single leaf", () => {
    const result = composition({ systemPrompt: "a plain custom prompt", anchoredTotalTokens: 100 });
    const rows = contextBucketRows(bucket(result, "system-prompt"));

    expect(rows.map((row) => row.id)).toEqual(["base"]);
    expect(rows[0].children).toEqual([]);
  });

  it("lists the seven message roles, summaries apart", () => {
    const result = composition({ messages: MESSAGES, anchoredTotalTokens: 500 });
    const rows = contextBucketRows(bucket(result, "messages"));

    expect(rows.map((row) => row.id)).toEqual([
      "user-text",
      "assistant-text",
      "thinking",
      "tool-call",
      "tool-result",
      "compaction-summary",
      "branch-summary",
    ]);
    expect(rows.every((row) => row.children.length === 0)).toBe(true);
    expectPartition(result, "messages", rows);
  });

  it("gives each tool schema its own row under its tool name", () => {
    const result = composition({
      tools: [
        { name: "read", description: "Read a file", parameters: { type: "object" } },
        { name: "bash", description: "Run a command", parameters: { type: "object" } },
      ],
      anchoredTotalTokens: 300,
    });
    const rows = contextBucketRows(bucket(result, "system-tools"));

    expect(rows.map((row) => row.id)).toEqual(["tool:read", "tool:bash"]);
    expectPartition(result, "system-tools", rows);
  });

  it("keeps the skills listing as a single row", () => {
    const result = composition({ systemPrompt: SYSTEM_PROMPT, anchoredTotalTokens: 1000 });
    const rows = contextBucketRows(bucket(result, "skills"));

    expect(rows.map((row) => row.id)).toEqual(["skills"]);
    expect(rows[0].children).toEqual([]);
  });

  it("partitions every bucket, with and without a provider anchor", () => {
    const anchored = composition({ systemPrompt: SYSTEM_PROMPT, messages: MESSAGES, anchoredTotalTokens: 4321 });
    const unanchored = composition({ systemPrompt: SYSTEM_PROMPT, messages: MESSAGES });

    for (const result of [anchored, unanchored]) {
      for (const id of ["system-prompt", "system-tools", "skills", "messages"] as const) {
        const rows = contextBucketRows(bucket(result, id));
        expectPartition(result, id, rows);
        if (result.anchoredTotalTokens === null) {
          expect(rows.every((row) => row.tokens === null && row.percent === null)).toBe(true);
        }
      }
    }
  });

  it("returns no rows for the buckets a fresh session has nothing in", () => {
    const result = composition({ anchoredTotalTokens: 1234 });

    expect(contextBucketRows(bucket(result, "system-prompt"))).toEqual([]);
    expect(contextBucketRows(bucket(result, "skills"))).toEqual([]);
    expect(contextBucketRows(bucket(result, "system-tools"))).toEqual([]);
    // The message bucket always keeps its seven roles, all at zero: the panel
    // promises seven rows, and "thinking: 0" is information, not noise.
    const messages = contextBucketRows(bucket(result, "messages"));
    expect(messages).toHaveLength(7);
    expect(messages.every((row) => row.localTokens === 0 && row.tokens === null)).toBe(true);
  });
});
