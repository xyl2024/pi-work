import { describe, expect, it } from "vitest";
import {
  splitBaseBlocks,
  splitSystemPrompt,
  splitSystemPromptLeaves,
} from "@/lib/shared/system-prompt-segments";

// Characterization tests for the segmentation that used to live inside the
// `"use client"` AppShell component. The move to a pure module is a
// prefactor (#36): the Context panel must keep rendering exactly what it did,
// and `context-composition` needs the *offsets* the old code never exposed.
//
// The fixtures mirror what pi's `buildSystemPrompt` actually assembles —
// base prompt (with its section headings) → APPEND_SYSTEM.md → project
// context files wrapped in `<project_instructions>` → skills listing →
// current working directory.

const BASE = `You are an expert coding assistant operating inside pi, a coding agent harness.

Available tools:
- read: Read the contents of a file
- bash: Execute a bash command

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Be concise in your responses

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /pi/README.md
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

const APPEND = `

APPENDED SYSTEM PROMPT`;

const PROJECT_ONE = `

<project_context>

Project-specific instructions and guidelines:

<project_instructions path="/repo/AGENTS.md">
# AGENTS.md

Be careful.
</project_instructions>

`;

const PROJECT_TWO = `<project_instructions path="/repo/packages/app/AGENTS.md">
# Package rules
</project_instructions>

</project_context>
`;

const SKILLS = `
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

<available_skills>
  <skill>
    <name>playwright-cli</name>
    <description>Automate browser interactions.</description>
    <location>/home/me/.pi/agent/skills/playwright-cli/SKILL.md</location>
  </skill>
</available_skills>`;

const CWD = `
Current working directory: /repo`;

const FULL = BASE + APPEND + PROJECT_ONE + PROJECT_TWO + SKILLS + CWD;

function expectTiling(spans: Array<{ start: number; end: number }>, length: number) {
  expect(spans[0].start).toBe(0);
  expect(spans[spans.length - 1].end).toBe(length);
  for (let i = 0; i < spans.length; i++) {
    expect(spans[i].end).toBeGreaterThan(spans[i].start);
    if (i > 0) {
      // non-overlapping and gap-free
      expect(spans[i].start).toBe(spans[i - 1].end);
    }
  }
}

/** Same as `expectTiling`, for spans shifted by a base offset. */
function expectShiftedTiling(spans: Array<{ start: number; end: number }>, from: number, to: number) {
  expect(spans[0].start).toBe(from);
  expect(spans[spans.length - 1].end).toBe(to);
  for (let i = 0; i < spans.length; i++) {
    expect(spans[i].end).toBeGreaterThan(spans[i].start);
    if (i > 0) expect(spans[i].start).toBe(spans[i - 1].end);
  }
}

describe("splitSystemPrompt", () => {
  it("tiles the whole prompt with base and agents slices", () => {
    const segments = splitSystemPrompt(FULL);

    expectTiling(segments, FULL.length);
    expect(segments.map((segment) => segment.kind)).toEqual(["base", "agents", "base", "agents", "base"]);
    // `text` strips the AGENTS wrapper newlines for display, so the offsets —
    // not the concatenated display text — are what cover the original string.
    expect(segments.map((segment) => FULL.slice(segment.start, segment.end)).join("")).toBe(FULL);
  });

  it("keeps the agents display text while its offsets cover the wrapper tags", () => {
    const agents = splitSystemPrompt(FULL).find((segment) => segment.kind === "agents" && segment.path === "/repo/AGENTS.md");
    expect(agents).toBeDefined();
    if (!agents || agents.kind !== "agents") throw new Error("expected an agents segment");

    expect(agents.text).toBe("# AGENTS.md\n\nBe careful.");
    expect(FULL.slice(agents.start, agents.end)).toBe(
      '<project_instructions path="/repo/AGENTS.md">\n# AGENTS.md\n\nBe careful.\n</project_instructions>',
    );
  });

  it("covers a prompt with no project instructions in a single base slice", () => {
    const prompt = BASE + CWD;
    const segments = splitSystemPrompt(prompt);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: "base", start: 0, end: prompt.length, text: prompt });
  });

  it("returns nothing for an empty prompt", () => {
    expect(splitSystemPrompt("")).toEqual([]);
  });
});

describe("splitBaseBlocks", () => {
  it("tiles its input and exposes each known anchor", () => {
    const blocks = splitBaseBlocks(FULL);

    expectTiling(blocks, FULL.length);
    const anchors = blocks.map((block) => block.anchor);
    expect(anchors).toContain("available-tools");
    expect(anchors).toContain("guidelines");
    expect(anchors).toContain("pi-docs");
    expect(anchors).toContain("append");
    expect(anchors).toContain("skills");
    // The blocks are a partition, so every character is in exactly one block.
    expect(blocks.map((block) => block.text).join("")).toBe(FULL);
  });

  it("offsets blocks relative to the whole system prompt when given a base offset", () => {
    const segment = splitSystemPrompt(FULL)[0];
    if (segment.kind !== "base") throw new Error("expected a base segment");

    const blocks = splitBaseBlocks(segment.text, segment.start);

    expectShiftedTiling(blocks, segment.start, segment.end);
    expect(blocks.map((block) => block.text).join("")).toBe(segment.text);
  });

  it("keeps the pre-move block boundaries (frozen behavior)", () => {
    // These anchors are what the Context panel's quick-jump menu is built
    // from; the move to a pure module must not move a single boundary.
    expect(splitBaseBlocks(FULL).map((block) => block.anchor)).toEqual([
      null,
      "available-tools",
      "guidelines",
      "pi-docs",
      "append",
      "skills",
    ]);
  });

  it("omits anchors the prompt does not contain", () => {
    const blocks = splitBaseBlocks("just a plain custom prompt");
    expect(blocks).toEqual([{ anchor: null, start: 0, end: 26, text: "just a plain custom prompt" }]);
  });
});

describe("splitSystemPromptLeaves", () => {
  it("partitions the prompt and carves skills out as its own leaf", () => {
    const leaves = splitSystemPromptLeaves(FULL);

    expectTiling(leaves, FULL.length);
    expect(leaves.map((item) => FULL.slice(item.start, item.end)).join("")).toBe(FULL);

    const skills = leaves.filter((leaf) => leaf.kind === "skills");
    expect(skills).toHaveLength(1);
    // The composition bucket is the whole listing, preamble included.
    expect(skills[0].text.startsWith("The following skills provide specialized instructions")).toBe(true);
    expect(skills[0].text.endsWith("</available_skills>")).toBe(true);
  });

  it("always covers the full string, even with no skills and no project files", () => {
    const prompt = BASE + CWD;
    const leaves = splitSystemPromptLeaves(prompt);

    expectTiling(leaves, prompt.length);
    expect(leaves.every((leaf) => leaf.kind === "base")).toBe(true);
  });

  it("returns no leaves for an empty prompt", () => {
    expect(splitSystemPromptLeaves("")).toEqual([]);
  });
});
