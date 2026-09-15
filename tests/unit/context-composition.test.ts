import { describe, expect, it } from "vitest";
import {
  computeContextComposition,
  formatCompositionPercent,
  formatEstimatedTokens,
  type ContextBucketId,
  type ContextComposition,
  type ContextCompositionInput,
} from "@/lib/shared/context-composition";

// ── Fixtures ──
//
// `countTokens` is injected, so these tests can use a cheap deterministic fake.
// The real tokenizer is a server-only dynamic import (see
// `lib/server/context-tokenizer.ts`) and must never be reachable from here —
// that is the whole point of the injection.

/** One token per 4 characters, floored — enough to make the arithmetic
 *  checkable by hand without caring about real BPE ranks. Note it is *not*
 *  additive across a split (`floor(a/4) + floor(b/4) !== floor((a+b)/4)`),
 *  which is exactly the property prefix differencing has to handle. */
const chars4 = (text: string) => Math.floor(text.length / 4);

function composition(input: Partial<ContextCompositionInput>) {
  return computeContextComposition({
    systemPrompt: input.systemPrompt ?? null,
    tools: input.tools ?? null,
    messages: input.messages ?? null,
    anchoredTotalTokens: input.anchoredTotalTokens ?? null,
    countTokens: input.countTokens ?? chars4,
  });
}

function bucket(composition: ContextComposition, id: ContextBucketId) {
  const found = composition.buckets.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no bucket ${id}`);
  return found;
}

function leaf(composition: ContextComposition, bucketId: ContextBucketId, leafId: string) {
  const found = bucket(composition, bucketId).leaves.find((candidate) => candidate.id === leafId);
  if (!found) throw new Error(`no leaf ${leafId} in ${bucketId}`);
  return found;
}

const sum = (values: Array<number | null>) => values.reduce((total: number, value) => total + (value ?? 0), 0);

const SYSTEM_PROMPT = `You are an expert coding assistant operating inside pi, a coding agent harness.

Available tools:
- read: Read the contents of a file
- bash: Execute a bash command

Guidelines:
- Be concise in your responses

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /pi/README.md
- Always read pi .md files completely and follow links to related docs

<project_context>

Project-specific instructions and guidelines:

<project_instructions path="/repo/AGENTS.md">
# AGENTS.md

Keep it short.
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

const TOOLS = [
  { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
  { name: "bash", description: "Run a command", parameters: { type: "object" } },
];

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
  { role: "toolResult", content: [{ type: "text", text: "file contents" }], toolCallId: "t1" },
  { role: "bashExecution", command: "ls", output: "a.ts" },
  { role: "custom", content: "custom note" },
  { role: "compactionSummary", summary: "a long summary" },
  { role: "branchSummary", summary: "a branch summary" },
];

describe("computeContextComposition", () => {
  it("always returns the four canonical buckets, even for empty input", () => {
    const result = composition({});
    expect(result.buckets.map((candidate) => candidate.id)).toEqual([
      "system-prompt",
      "system-tools",
      "skills",
      "messages",
    ]);
    expect(result.localTotal).toBe(0);
    expect(result.anchoredTotalTokens).toBeNull();
  });

  it("anchors every leaf to the provider total exactly", () => {
    const result = composition({ systemPrompt: SYSTEM_PROMPT, tools: TOOLS, messages: MESSAGES, anchoredTotalTokens: 700 });

    expect(result.localTotal).toBeGreaterThan(0);
    expect(sum(result.buckets.map((candidate) => candidate.tokens))).toBe(700);
    const leafTokens = result.buckets.flatMap((candidate) => candidate.leaves.map((item) => item.tokens));
    expect(sum(leafTokens)).toBe(700);
    expect(sum(result.buckets.map((candidate) => candidate.percent))).toBeCloseTo(100, 10);
    expect(result.buckets.every((candidate) => candidate.percent !== null)).toBe(true);
  });

  it("keeps every parent equal to the sum of its children", () => {
    const result = composition({ systemPrompt: SYSTEM_PROMPT, tools: TOOLS, messages: MESSAGES, anchoredTotalTokens: 1234 });

    for (const candidate of result.buckets) {
      expect(candidate.localTokens).toBe(sum(candidate.leaves.map((item) => item.localTokens)));
      expect(candidate.tokens).toBe(sum(candidate.leaves.map((item) => item.tokens)));
    }
    expect(result.localTotal).toBe(sum(result.buckets.map((candidate) => candidate.localTokens)));
  });

  it("carves skills out so system prompt + skills equals the whole system prompt", () => {
    const result = composition({ systemPrompt: SYSTEM_PROMPT });
    const prompt = bucket(result, "system-prompt");
    const skills = bucket(result, "skills");

    expect(prompt.localTokens).toBeGreaterThan(0);
    expect(skills.localTokens).toBeGreaterThan(0);
    // Prefix differencing telescopes: counting the slices independently would
    // not add up, because `chars4` is not additive across a split.
    expect(prompt.localTokens + skills.localTokens).toBe(chars4(SYSTEM_PROMPT));
  });

  it("splits the transcript into the seven message buckets, summaries apart", () => {
    const result = composition({ messages: MESSAGES });

    expect(bucket(result, "messages").leaves.map((item) => item.id)).toEqual([
      "user-text",
      "assistant-text",
      "thinking",
      "tool-call",
      "tool-result",
      "compaction-summary",
      "branch-summary",
    ]);
    // user + bashExecution + custom land together in "user-side text" …
    expect(leaf(result, "messages", "user-text").localTokens).toBe(
      chars4("hello world") + chars4("lsa.ts") + chars4("custom note"),
    );
    // … while the folded-into-user summaries stay their own buckets.
    expect(leaf(result, "messages", "compaction-summary").localTokens).toBe(chars4("a long summary"));
    expect(leaf(result, "messages", "branch-summary").localTokens).toBe(chars4("a branch summary"));
    expect(leaf(result, "messages", "tool-result").localTokens).toBe(chars4("file contents"));
  });

  it("serializes a tool from its name, description and parameter schema", () => {
    const result = composition({ tools: [{ name: "read", description: "Read a file", parameters: { type: "object" } }] });

    const tool = bucket(result, "system-tools").leaves[0];
    expect(tool.id).toBe("tool:read");
    expect(tool.localTokens).toBe(chars4('read\nRead a file\n{"type":"object"}'));
  });

  it("normalizes in both directions", () => {
    // local 100 → total 1000 (k = 10)
    const up = composition({ tools: [{ name: "x", description: "y", parameters: {} }], anchoredTotalTokens: 1000, countTokens: () => 100 });
    // local 100 → total 10 (k = 0.1)
    const down = composition({ tools: [{ name: "x", description: "y", parameters: {} }], anchoredTotalTokens: 10, countTokens: () => 100 });

    expect(bucket(up, "system-tools").localTokens).toBe(100);
    expect(bucket(up, "system-tools").tokens).toBe(1000);
    expect(bucket(down, "system-tools").localTokens).toBe(100);
    expect(bucket(down, "system-tools").tokens).toBe(10);
  });

  it("covers a system prompt with no messages", () => {
    const result = composition({ systemPrompt: SYSTEM_PROMPT, anchoredTotalTokens: 1000 });

    const messages = bucket(result, "messages");
    expect(messages.localTokens).toBe(0);
    expect(messages.tokens).toBe(0);
    expect(messages.percent).toBe(0);
    expect(bucket(result, "system-prompt").tokens).toBe(1000 - (bucket(result, "skills").tokens ?? 0));
  });

  it("never produces NaN or Infinity for empty / zero-size inputs", () => {
    const empty = composition({ anchoredTotalTokens: 500 });
    const zeroTotal = composition({ systemPrompt: "x".repeat(400), anchoredTotalTokens: 0 });
    const nothingToClassify = composition({ anchoredTotalTokens: 42_000 });

    expect(empty.localTotal).toBe(0);
    expect(empty.buckets.every((candidate) => candidate.tokens === null && candidate.percent === null)).toBe(true);
    expect(zeroTotal.anchoredTotalTokens).toBeNull();
    expect(zeroTotal.buckets.every((candidate) => candidate.tokens === null && candidate.percent === null)).toBe(true);
    // An anchor with nothing local to distribute degrades to unanchored rather
    // than inventing a split that doesn't add up.
    expect(nothingToClassify.anchoredTotalTokens).toBeNull();
    for (const candidate of [...empty.buckets, ...zeroTotal.buckets, ...nothingToClassify.buckets]) {
      expect(Number.isFinite(candidate.localTokens)).toBe(true);
      expect(candidate.percent === null || Number.isFinite(candidate.percent)).toBe(true);
    }
  });

  it("treats a non-finite anchor or count as unanchored / zero", () => {
    const result = composition({
      systemPrompt: "x".repeat(400),
      anchoredTotalTokens: Number.NaN,
      countTokens: () => Number.POSITIVE_INFINITY,
    });

    expect(result.anchoredTotalTokens).toBeNull();
    expect(result.localTotal).toBe(0);
    expect(result.buckets.every((candidate) => candidate.tokens === null)).toBe(true);
  });

  it("clamps a negative local count instead of propagating it", () => {
    const result = composition({ systemPrompt: "x", anchoredTotalTokens: 10, countTokens: () => -5 });

    expect(result.localTotal).toBe(0);
    expect(result.buckets.every((candidate) => candidate.localTokens === 0)).toBe(true);
  });

  it("ignores bash executions excluded from the model context (`!!` prefix)", () => {
    const included = composition({ messages: [{ role: "bashExecution", command: "ls", output: "a.ts" }] });
    const excluded = composition({
      messages: [{ role: "bashExecution", command: "ls", output: "a.ts", excludeFromContext: true }],
    });

    expect(leaf(included, "messages", "user-text").localTokens).toBe(chars4("lsa.ts"));
    expect(leaf(excluded, "messages", "user-text").localTokens).toBe(0);
  });

  it("ignores unknown message roles instead of guessing a bucket", () => {
    const result = composition({ messages: [{ role: "mystery", content: "???".repeat(40) }] });

    expect(bucket(result, "messages").localTokens).toBe(0);
  });
});

describe("formatCompositionPercent", () => {
  it("drops a trailing .0 and keeps one decimal otherwise", () => {
    expect(formatCompositionPercent(100)).toBe("100");
    expect(formatCompositionPercent(33.333)).toBe("33.3");
  });
});

describe("formatEstimatedTokens", () => {
  it("prefixes a local estimate with `≈`, the total's only tell apart", () => {
    // ADR-0005: the provider total is printed bare, so every classified number
    // goes through this helper — the ring tooltip and the composition panel
    // must not each invent their own convention.
    expect(formatEstimatedTokens(12_300)).toBe("≈ 12.3K");
    expect(formatEstimatedTokens(0)).toBe("≈ 0.0K");
  });
});
