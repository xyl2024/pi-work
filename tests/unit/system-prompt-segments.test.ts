import { describe, expect, it } from "vitest";
import {
  dropSystemPromptSection,
  splitBaseBlocks,
  splitSystemPrompt,
  splitSystemPromptLeaves,
  stripDefaultSystemPromptSections,
  stripPiDocumentationSection,
} from "@/lib/shared/system-prompt-segments";

// Characterization tests for the segmentation that used to live inside the
// `"use client"` AppShell component. The move to a pure module is a
// prefactor (#36): the Context panel must keep rendering exactly what it did,
// and `context-composition` needs the *offsets* the old code never exposed.
//
// The fixtures mirror what pi's `buildSystemPrompt` actually assembles since
// 0.86: an untagged persona paragraph followed by tagged sections
// (`<tools>`, `<rules>`, `<docs>`, `<addendum>`, `<project_context>`,
// `<skills>`, `<cwd>`) joined by blank lines. The Context panel keeps its own
// anchor vocabulary (available-tools / guidelines / pi-docs / append), so the
// tag names are translated rather than renamed.

const PREAMBLE =
  "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

const TOOLS = `<tools>
- read: Read the contents of a file
- bash: Execute a bash command

In addition to the tools above, you may have access to other custom tools depending on the project.
</tools>`;

const RULES = `<rules>
- Be concise in your responses
</rules>`;

const DOCS = `<docs>
Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /pi/README.md
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)
</docs>`;

const ADDENDUM = `<addendum>
APPENDED SYSTEM PROMPT
</addendum>`;

const PROJECT_CONTEXT = `<project_context>
Project-specific instructions and guidelines:

<project_instructions path="/repo/AGENTS.md">
# AGENTS.md

Be careful.
</project_instructions>

<project_instructions path="/repo/packages/app/AGENTS.md">
# Package rules
</project_instructions>
</project_context>`;

const SKILLS = `<skills>
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

<available_skills>
  <skill>
    <name>playwright-cli</name>
    <description>Automate browser interactions.</description>
    <location>/home/me/.pi/agent/skills/playwright-cli/SKILL.md</location>
  </skill>
</available_skills>
</skills>`;

const CWD = `<cwd>
/repo
</cwd>`;

const FULL = [PREAMBLE, TOOLS, RULES, DOCS, ADDENDUM, PROJECT_CONTEXT, SKILLS, CWD].join("\n\n");

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
    // `text` is a display slice, so the offsets — not the concatenated display
    // text — are what cover the original string.
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

  it("leaves the <project_context> wrapper out of the base slices", () => {
    // The wrapper is pi scaffolding; it must not reach the panel as content.
    // Its bytes still belong to the base slices so the offsets keep tiling.
    const base = splitSystemPrompt(FULL)
      .filter((segment) => segment.kind === "base")
      .map((segment) => FULL.slice(segment.start, segment.end))
      .join("");

    expect(base).toContain("<project_context>\n");
    expect(base).toContain("\n</project_context>");
    const displayed = splitBaseBlocks(base)
      .map((block) => block.text)
      .join("");
    expect(displayed).not.toContain("project_context");
    expect(displayed).toContain("Project-specific instructions and guidelines:");
  });

  it("covers a prompt with no project instructions in a single base slice", () => {
    const prompt = `${PREAMBLE}\n\n${CWD}`;
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
    expect(anchors).toContain("cwd");
    // The offsets are a partition of the original, so every character is in
    // exactly one block even though the display text drops the tags.
    expect(blocks.map((block) => FULL.slice(block.start, block.end)).join("")).toBe(FULL);
  });

  it("strips the section scaffolding from the display text", () => {
    const blocks = splitBaseBlocks(FULL);
    const tools = blocks.find((block) => block.anchor === "available-tools")!;

    expect(tools.text).not.toContain("<tools>");
    expect(tools.text).not.toContain("</tools>");
    expect(tools.text).toContain("- read: Read the contents of a file");
    // The offsets still cover the tags, which is what prefix differencing needs.
    expect(FULL.slice(tools.start, tools.end).startsWith("<tools>\n")).toBe(true);
    expect(FULL.slice(tools.start, tools.end).endsWith("\n</tools>")).toBe(true);

    const cwd = blocks.find((block) => block.anchor === "cwd")!;
    expect(cwd.text).toBe("/repo");
  });

  it("offsets blocks relative to the whole system prompt when given a base offset", () => {
    const segment = splitSystemPrompt(FULL)[0];
    if (segment.kind !== "base") throw new Error("expected a base segment");

    const blocks = splitBaseBlocks(segment.text, segment.start);

    expectShiftedTiling(blocks, segment.start, segment.end);
    expect(blocks.map((block) => FULL.slice(block.start, block.end)).join("")).toBe(segment.text);
  });

  it("anchors every section the panel knows about, in prompt order", () => {
    // These anchors are what the Context panel's quick-jump menu is built
    // from, so the mapping from pi's tag names to the panel's vocabulary has to
    // stay complete.
    expect(splitBaseBlocks(FULL).map((block) => block.anchor)).toEqual([
      null,
      "available-tools",
      null,
      "guidelines",
      null,
      "pi-docs",
      null,
      "append",
      null,
      "skills",
      null,
      "cwd",
    ]);
  });

  it("omits anchors the prompt does not contain", () => {
    const blocks = splitBaseBlocks("just a plain custom prompt");
    expect(blocks).toEqual([{ anchor: null, start: 0, end: 26, text: "just a plain custom prompt" }]);
  });

  it("returns no blocks for an empty prompt", () => {
    expect(splitBaseBlocks("")).toEqual([]);
  });
});

describe("splitSystemPromptLeaves", () => {
  it("partitions the prompt and carves skills out as its own leaf", () => {
    const leaves = splitSystemPromptLeaves(FULL);

    expectTiling(leaves, FULL.length);
    expect(leaves.map((item) => FULL.slice(item.start, item.end)).join("")).toBe(FULL);

    const skills = leaves.filter((leaf) => leaf.kind === "skills");
    expect(skills).toHaveLength(1);
    // The composition bucket is the whole section, not just the tag inside it.
    expect(skills[0].text.startsWith("The following skills provide specialized instructions")).toBe(true);
    expect(skills[0].text.endsWith("</available_skills>")).toBe(true);
  });

  it("always covers the full string, even with no skills and no project files", () => {
    const prompt = `${PREAMBLE}\n\n${CWD}`;
    const leaves = splitSystemPromptLeaves(prompt);

    expectTiling(leaves, prompt.length);
    expect(leaves.every((leaf) => leaf.kind === "base")).toBe(true);
  });

  it("returns no leaves for an empty prompt", () => {
    expect(splitSystemPromptLeaves("")).toEqual([]);
  });

  it("gives the working directory its own leaf", () => {
    const leaves = splitSystemPromptLeaves(FULL);

    expectTiling(leaves, FULL.length);
    const cwd = leaves[leaves.length - 1];
    expect(cwd.id).toBe("cwd");
    expect(cwd.text).toBe("/repo");
    // Offsets cover the section tags; only the display text strips them.
    expect(FULL.slice(cwd.start, cwd.end)).toBe("<cwd>\n/repo\n</cwd>");
  });

  it("keeps the skills bucket out of the system-prompt leaves' way", () => {
    const prompt = `${PREAMBLE}\n\n${SKILLS}\n\n${CWD}`;
    const leaves = splitSystemPromptLeaves(prompt);

    expectTiling(leaves, prompt.length);
    expect(leaves.filter((leaf) => leaf.kind === "skills")).toHaveLength(1);
    expect(leaves[leaves.length - 1].id).toBe("cwd");
  });

  it("never mistakes an AGENTS.md tail for the working directory", () => {
    const prompt =
      `<project_context>\n<project_instructions path="/repo/AGENTS.md">\nsee:\nCurrent working directory: /nope\n</project_instructions>\n</project_context>\n\n${CWD}`;
    const leaves = splitSystemPromptLeaves(prompt);

    expectTiling(leaves, prompt.length);
    const agents = leaves.find((leaf) => leaf.kind === "agents")!;
    expect(agents.id).toBe("agents:/repo/AGENTS.md");
    expect(agents.text).toContain("Current working directory: /nope");
    const cwd = leaves.find((leaf) => leaf.id === "cwd")!;
    expect(cwd.text).toBe("/repo");
  });
});

describe("prompt section rewriting", () => {
  it("drops a section with its tags and the blank lines around it", () => {
    const stripped = dropSystemPromptSection(FULL, "docs");

    expect(stripped).not.toContain("<docs>");
    expect(stripped).not.toContain("Pi documentation");
    // Nothing else is consumed: the sections on either side survive intact.
    expect(stripped).toContain("<rules>\n- Be concise in your responses\n</rules>");
    expect(stripped).toContain("<addendum>\nAPPENDED SYSTEM PROMPT\n</addendum>");
    expect(stripped).not.toContain("\n\n\n\n");
  });

  it("leaves a prompt without the section untouched", () => {
    const prompt = `${PREAMBLE}\n\n${CWD}`;
    expect(dropSystemPromptSection(prompt, "docs")).toBe(prompt);
  });

  it("removes only the pi-docs section for the load_pi_docs toggle", () => {
    const stripped = stripPiDocumentationSection(FULL);

    expect(stripped).not.toContain("Pi documentation");
    // Everything the toggle must preserve is still there.
    expect(stripped).toContain("<tools>");
    expect(stripped).toContain("<addendum>\nAPPENDED SYSTEM PROMPT");
    expect(stripped).toContain('<project_instructions path="/repo/AGENTS.md">');
    expect(stripped).toContain("<cwd>\n/repo\n</cwd>");
  });

  it("flattens the prompt for a specialized subagent", () => {
    const flat = stripDefaultSystemPromptSections(FULL);

    // The generic pi framing is gone.
    expect(flat).not.toContain("You are an expert coding assistant");
    expect(flat).not.toContain("In addition to the tools above");
    expect(flat).not.toContain("Pi documentation");
    // No section scaffolding survives…
    for (const name of ["tools", "rules", "docs", "addendum", "project_context", "skills", "cwd"]) {
      expect(flat).not.toContain(`<${name}>`);
      expect(flat).not.toContain(`</${name}>`);
    }
    // …and the bodies keep the headings the subagent prompts are written for.
    expect(flat).toContain("Available tools:\n- read: Read the contents of a file");
    expect(flat).toContain("Guidelines:\n- Be concise in your responses");
    expect(flat).toContain("Current working directory: /repo");
    expect(flat).toContain("APPENDED SYSTEM PROMPT");
    expect(flat).toContain("# AGENTS.md");
  });
});
