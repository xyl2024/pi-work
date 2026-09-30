import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLE_NAMES,
  buildTemplateVariableValues,
  composeSystemPrompt,
  createDefaultTemplate,
  findTemplateWarnings,
  normalizeSystemPromptTemplate,
  planSystemPromptOptions,
  renderSystemPromptTemplate,
  type TemplateMaterial,
  type TemplateVariableValues,
} from "@/lib/shared/system-prompt-template";
import { SYSTEM_PROMPT_SECTION_NAMES } from "@/lib/shared/system-prompt-segments";
import { getDocsPath, getExamplesPath, getReadmePath, type Skill } from "@earendil-works/pi-coding-agent";
// Deep import, **tests only** (see the module header): the SDK does not export
// `buildSystemPrompt` from its top level, and its `exports` map does not
// advertise `./dist/core/system-prompt.js`, so the path has to be relative to
// dodge package resolution. Production code must never do this.
import { buildSystemPrompt } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";

// The real docs paths: `buildSystemPrompt` inlines them itself, so the parity
// test only matches when the injected material uses the same values.
const DOCS_PATHS = { readme: getReadmePath(), docs: getDocsPath(), examples: getExamplesPath() };

const SKILLS: Skill[] = [
  {
    name: "code-review",
    description: "Review the changes since a fixed point.",
    filePath: "/repo/.agents/skills/code-review/SKILL.md",
    baseDir: "/repo/.agents/skills/code-review",
    sourceInfo: { path: "/repo/.agents/skills/code-review/SKILL.md", source: "top-level", scope: "project", origin: "top-level" },
    disableModelInvocation: false,
  },
  {
    name: "hidden",
    description: "Never shown to the model.",
    filePath: "/repo/.agents/skills/hidden/SKILL.md",
    baseDir: "/repo/.agents/skills/hidden",
    sourceInfo: { path: "/repo/.agents/skills/hidden/SKILL.md", source: "top-level", scope: "project", origin: "top-level" },
    disableModelInvocation: true,
  },
];

function material(overrides: Partial<TemplateMaterial> = {}): TemplateMaterial {
  return {
    selectedTools: ["read", "bash", "edit", "write"],
    toolSnippets: {
      read: "Read the contents of a file",
      bash: "Execute a bash command",
      edit: "Edit a file",
      write: "Write a new file",
    },
    toolGuidelines: {
      read: ["Read files completely before editing them"],
    },
    promptGuidelines: [],
    appendSystemPrompt: "APPENDED SYSTEM PROMPT",
    contextFiles: [{ path: "/repo/AGENTS.md", content: "# AGENTS.md\n\nBe careful." }],
    skills: SKILLS,
    cwd: "/repo",
    docsPaths: DOCS_PATHS,
    model: "anthropic/claude-sonnet-4",
    thinkingLevel: "high",
    date: "2025-01-02",
    ...overrides,
  };
}

function renderDefault(input: TemplateMaterial): string {
  return renderSystemPromptTemplate(DEFAULT_SYSTEM_PROMPT_TEMPLATE, buildTemplateVariableValues(input));
}

/** The shape pi's `buildSystemPrompt` accepts, spelled out so the parity test
 *  feeds both renderers the same input. */
function piOptions(input: TemplateMaterial) {
  return {
    cwd: input.cwd,
    selectedTools: input.selectedTools,
    toolSnippets: input.toolSnippets,
    toolGuidelines: input.toolGuidelines,
    promptGuidelines: input.promptGuidelines,
    appendSystemPrompt: input.appendSystemPrompt,
    contextFiles: input.contextFiles,
    // The fixtures carry full `Skill` objects; `TemplateMaterial` only names the
    // four fields a renderer reads, so the narrowing has to be undone here.
    skills: input.skills as Skill[],
  };
}

describe("default template parity with pi", () => {
  // The whole point of the default template: rendering it with the copied
  // renderer has to produce byte-identical text to pi's own assembly, so that
  // doing nothing changes nothing.
  it.each([
    ["bash alone (shell rule)", { selectedTools: ["read", "bash", "edit", "write"] }],
    ["bash + grep (no shell rule)", { selectedTools: ["read", "bash", "grep"] }],
    [
      "powershell alone",
      {
        selectedTools: ["read", "powershell"],
        toolSnippets: { read: "Read the contents of a file", powershell: "Execute a PowerShell command" },
      },
    ],
    ["no append block", { appendSystemPrompt: "" }],
    ["no context file", { contextFiles: [] }],
    ["no skills", { skills: [] }],
  ] as Array<[string, Partial<TemplateMaterial>]>)("matches for %s", (_label, overrides) => {
    const input = material(overrides);
    expect(composeSystemPrompt(renderDefault(input), input.cwd)).toEqual(buildSystemPrompt(piOptions(input)));
  });

  it("orders the default template exactly like pi", () => {
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE.map((f) => (f.kind === "variable" ? f.name : "text"))).toEqual([
      "preamble",
      "tools",
      "rules",
      "docs",
      "addendum",
      "project_context",
      "skills",
    ]);
  });
});

describe("variable catalog", () => {
  it("names every catalog entry exactly once, in catalog order", () => {
    expect([...TEMPLATE_VARIABLE_NAMES].sort()).toEqual(Object.keys(TEMPLATE_VARIABLES).sort());
    expect(new Set(TEMPLATE_VARIABLE_NAMES).size).toEqual(TEMPLATE_VARIABLE_NAMES.length);
  });

  it("keeps the pi-named variable tags aligned with the segment parser vocabulary", () => {
    const parsed = new Set<string>(SYSTEM_PROMPT_SECTION_NAMES);
    // Pi Work's own variables are deliberately outside the parser vocabulary:
    // the panel shows them as part of the surrounding base text.
    const piWorkOnly = new Set(["model", "thinking_level", "date"]);
    const catalogTags = new Set(
      TEMPLATE_VARIABLE_NAMES.map((name) => TEMPLATE_VARIABLES[name].tag).filter((tag): tag is string => tag !== null),
    );
    for (const tag of catalogTags) {
      if (piWorkOnly.has(tag)) continue;
      // Every pi-named variable (plus `project_context`, which the segment
      // parser reaches through its own wrapper regex) is a tag it understands.
      expect(parsed.has(tag) || tag === "project_context", `${tag} is not a tag system-prompt-segments understands`).toBe(true);
    }
    for (const tag of piWorkOnly) {
      expect(parsed.has(tag), `${tag} must stay out of the parser vocabulary`).toBe(false);
    }
    // ...and every parser tag except `cwd` is reachable from a variable. `cwd`
    // deliberately has none: pi appends it unconditionally and last.
    for (const tag of parsed) {
      if (tag === "cwd") continue;
      expect(catalogTags.has(tag), `${tag} has no variable`).toBe(true);
    }
    expect(TEMPLATE_VARIABLES.preamble.tag).toBeNull();
  });

  it("marks only the feature-carrying variables as functional", () => {
    const functional = TEMPLATE_VARIABLE_NAMES.filter((name) => TEMPLATE_VARIABLES[name].functional);
    expect(functional).toEqual(["addendum", "project_context", "skills"]);
  });
});

describe("rendering", () => {
  it("omits an empty variable entirely, tag included", () => {
    const values: TemplateVariableValues = {
      ...buildTemplateVariableValues(material()),
      addendum: "",
      project_context: "",
      skills: "",
    };
    const rendered = renderSystemPromptTemplate(DEFAULT_SYSTEM_PROMPT_TEMPLATE, values);
    expect(rendered).not.toContain("<addendum>");
    expect(rendered).not.toContain("<project_context>");
    expect(rendered).not.toContain("<skills>");
  });

  it("drops the tools block for an empty tool set, diverging from pi's `(none)`", () => {
    const rendered = renderDefault(material({ selectedTools: [], toolSnippets: {}, toolGuidelines: {} }));
    expect(rendered).not.toContain("<tools>");
    expect(rendered).not.toContain("In addition to the tools above");
    // pi itself still emits the block — this divergence is deliberate.
    expect(buildSystemPrompt(piOptions(material({ selectedTools: [], toolSnippets: {}, toolGuidelines: {} })))).toContain(
      "<tools>",
    );
  });

  it("follows fragment order", () => {
    const rendered = renderSystemPromptTemplate(
      [
        { id: "a", kind: "variable", name: "skills" },
        { id: "b", kind: "variable", name: "tools" },
      ],
      buildTemplateVariableValues(material()),
    );
    expect(rendered.indexOf("<skills>")).toBeLessThan(rendered.indexOf("<tools>"));
  });

  it("emits an untagged text fragment bare and an equal-tag one wrapped, joined by blank lines", () => {
    const rendered = renderSystemPromptTemplate(
      [
        { id: "a", kind: "variable", name: "preamble" },
        { id: "b", kind: "text", text: "Be terse." },
        { id: "c", kind: "text", tag: "house_rules", text: "No emoji." },
        { id: "d", kind: "text", text: "   " },
      ],
      buildTemplateVariableValues(material()),
    );
    expect(rendered).toContain("Be terse.\n\n<house_rules>\nNo emoji.\n</house_rules>");
    // Nothing is interpolated inside a text fragment.
    const literal = renderSystemPromptTemplate(
      [{ id: "a", kind: "text", text: "keep {{tools}} literal" }],
      buildTemplateVariableValues(material()),
    );
    expect(literal).toEqual("keep {{tools}} literal");
  });

  it("skips an empty text fragment but keeps a whitespace-only variable's neighbours", () => {
    const rendered = renderSystemPromptTemplate(
      [
        { id: "a", kind: "text", text: "" },
        { id: "b", kind: "variable", name: "date" },
        { id: "c", kind: "text", text: "end" },
      ],
      { ...buildTemplateVariableValues(material()), date: "" },
    );
    expect(rendered).toEqual("end");
  });

  it("appends pi's unconditional cwd section and keeps it last", () => {
    const rendered = renderDefault(material({ cwd: "C:\\repo\\sub" }));
    const composed = composeSystemPrompt(rendered, "C:\\repo\\sub");
    expect(composed.endsWith("<cwd>\nC:/repo/sub\n</cwd>")).toBe(true);
    expect(composed).toEqual(buildSystemPrompt(piOptions(material({ cwd: "C:\\repo\\sub" }))));
  });

  it("composes to nothing when the template renders to nothing", () => {
    expect(composeSystemPrompt("", "/repo")).toEqual("");
  });
});

describe("planSystemPromptOptions", () => {
  it("puts the render in customPrompt and clears everything pi would append", () => {
    expect(planSystemPromptOptions("RENDERED")).toEqual({
      customPrompt: "RENDERED",
      appendSystemPrompt: "",
      contextFiles: [],
      skills: [],
      sections: {},
    });
  });
});

describe("warnings", () => {
  it("reports a removed feature-carrying variable", () => {
    const template = createDefaultTemplate().filter(
      (fragment) => fragment.kind !== "variable" || fragment.name !== "project_context",
    );
    expect(findTemplateWarnings(template, "rendered")).toEqual([
      { code: "removed-functional-variable", variable: "project_context" },
    ]);
  });

  it("reports all three when none is present", () => {
    expect(findTemplateWarnings([{ id: "a", kind: "text", text: "hi" }], "hi")).toEqual([
      { code: "removed-functional-variable", variable: "addendum" },
      { code: "removed-functional-variable", variable: "project_context" },
      { code: "removed-functional-variable", variable: "skills" },
    ]);
  });

  it("reports an empty render alongside the removed variables", () => {
    const warnings = findTemplateWarnings([], "");
    expect(warnings).toContainEqual({ code: "empty-render" });
    expect(warnings.filter((w) => w.code === "removed-functional-variable")).toHaveLength(3);
  });

  it("stays quiet for the default template when it renders something", () => {
    expect(findTemplateWarnings(createDefaultTemplate(), renderDefault(material()))).toEqual([]);
  });
});

describe("normalizeSystemPromptTemplate", () => {
  it("returns an empty template for anything that is not an array", () => {
    expect(normalizeSystemPromptTemplate(null)).toEqual([]);
    expect(normalizeSystemPromptTemplate("nope")).toEqual([]);
    expect(normalizeSystemPromptTemplate({ fragments: [] })).toEqual([]);
  });

  it("drops unknown variables and malformed fragments", () => {
    expect(
      normalizeSystemPromptTemplate([
        { id: "a", kind: "variable", name: "nope" },
        { id: "b", kind: "other", text: "x" },
        null,
        "string",
        { id: "c", kind: "text", text: 42 },
        { id: "d", kind: "variable", name: "tools" },
      ]),
    ).toEqual([{ id: "d", kind: "variable", name: "tools" }]);
  });

  it("fills missing ids deterministically and keeps valid ones", () => {
    const once = normalizeSystemPromptTemplate([
      { kind: "text", text: "a" },
      { kind: "variable", name: "tools" },
      { id: "mine", kind: "text", text: "b" },
    ]);
    expect(once.map((f) => f.id)).toEqual(["text-0", "variable-1", "mine"]);
    expect(normalizeSystemPromptTemplate(once)).toEqual(once);
  });

  it("degrades an invalid or reserved tag to an untagged fragment", () => {
    expect(
      normalizeSystemPromptTemplate([
        { id: "a", kind: "text", tag: "Preamble", text: "x" },
        { id: "b", kind: "text", tag: "preamble", text: "y" },
        { id: "c", kind: "text", tag: "9bad", text: "z" },
        { id: "d", kind: "text", tag: "ok_tag", text: "w" },
      ]),
    ).toEqual([
      { id: "a", kind: "text", text: "x" },
      { id: "b", kind: "text", text: "y" },
      { id: "c", kind: "text", text: "z" },
      { id: "d", kind: "text", tag: "ok_tag", text: "w" },
    ]);
  });

  it("makes duplicate ids unique deterministically", () => {
    const once = normalizeSystemPromptTemplate([
      { id: "same", kind: "text", text: "a" },
      { id: "same", kind: "text", text: "b" },
    ]);
    expect(new Set(once.map((f) => f.id)).size).toEqual(2);
    expect(normalizeSystemPromptTemplate(once)).toEqual(once);
  });

  it("round-trips the default template", () => {
    expect(normalizeSystemPromptTemplate(createDefaultTemplate())).toEqual(createDefaultTemplate());
  });

  it("does not mutate the default template when creating a copy", () => {
    const copy = createDefaultTemplate();
    copy.push({ id: "extra", kind: "text", text: "hi" });
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toHaveLength(7);
  });
});
