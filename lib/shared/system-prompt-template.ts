// ============================================================================
// System prompt template (pure)
//
// pi assembles the system prompt itself: an untagged persona paragraph, then
// `<tools>` / `<rules>` / `<docs>` / `<addendum>` / `<project_context>` /
// `<skills>` / `<cwd>`, all in that fixed order. Pi Work used to only append to
// that result. The template replaces the whole thing: the user edits an
// *ordered list of fragments* — each either a piece of custom text (optionally
// wrapped in a tag) or a variable — and Pi Work renders the complete system
// prompt from it.
//
// The default template renders *exactly* pi's native assembly, so doing nothing
// changes nothing. "Exactly" is pinned by a character-for-character test
// against the SDK's own `buildSystemPrompt` (see
// `tests/unit/system-prompt-template.test.ts`), because this module copies pi's
// static text and its `buildRules` rules rather than slicing pi's output:
//
//   - the default persona sentence;
//   - the `<tools>` body and its "In addition to the tools above…" tail;
//   - the `<docs>` body (with the docs paths injected, so this module never
//     imports the SDK);
//   - `buildRules` (the shell-rule variants, per-tool guidelines, the two fixed
//     rules, dedupe, `- ` bullets);
//   - `formatSkillsForPrompt` (including its XML escaping).
//
// Two deliberate divergences from pi are baked in:
//
//   1. An empty variable renders nothing at all — tag included. pi instead
//      emits `<tools>(none)</tools>` plus its tail when no tool is visible;
//      here the whole block disappears.
//   2. There is no `cwd` variable. pi assigns the working directory section
//      unconditionally and always last, so `composeSystemPrompt` appends it
//      after the rendered template instead of letting the template move it.
//
// Like `systemPromptSegments` / `panelTabs` / `context-composition` (ADR-0002 /
// ADR-0003), this module may not import React, DOM, i18n, a client hook, the pi
// SDK, or anything from `lib/server`.
// ============================================================================

// ── Fragments ─────────────────────────────────────────────────────────────

/** A variable a fragment can pull into the prompt. The names follow pi's own
 *  section names (`tools` / `rules` / `docs` / `addendum` / `project_context` /
 *  `skills`) so a rendered tag is recognised by `system-prompt-segments`; the
 *  rest are Pi Work's own. */
export type TemplateVariableName =
  | "preamble"
  | "tools"
  | "rules"
  | "docs"
  | "addendum"
  | "project_context"
  | "skills"
  | "model"
  | "thinking_level"
  | "date";

/** One entry of a system prompt template. `text` fragments carry their own
 *  content (optionally wrapped in `tag`); `variable` fragments are filled from
 *  the render input. Text is emitted verbatim — no interpolation, ever. */
export type PromptTemplateFragment =
  | { id: string; kind: "text"; tag?: string; text: string }
  | { id: string; kind: "variable"; name: TemplateVariableName };

/** An ordered list of fragments — the thing the user drags around and saves to
 *  `config.yaml` as `system_prompt_template`. */
export type SystemPromptTemplate = PromptTemplateFragment[];

// ── Variable catalog ──────────────────────────────────────────────────────

export interface TemplateVariableSpec {
  /** XML tag the variable renders as; `null` for the untagged `preamble`. */
  tag: string | null;
  /** i18n key (English source text) used as the human label. */
  labelKey: string;
  /** i18n key (English source text) explaining what the variable is. */
  descriptionKey: string;
  /** Removing the variable silently disables a feature, so the UI warns. */
  functional: boolean;
}

/** The variable name → tag/id mapping must stay aligned with
 *  `system-prompt-segments`'s `SECTION_RE` for the pi-named variables, or the
 *  Context panel cannot parse the rendered tag back. `model` /
 *  `thinking_level` / `date` are Pi Work's own tags and are intentionally *not*
 *  added to `SECTION_RE`: the panel shows them as part of the surrounding base
 *  text rather than as their own anchored section. */
export const TEMPLATE_VARIABLES: Record<TemplateVariableName, TemplateVariableSpec> = {
  preamble: {
    tag: null,
    labelKey: "Persona",
    descriptionKey: "The opening paragraph that says what the agent is.",
    functional: false,
  },
  tools: {
    tag: "tools",
    labelKey: "Available tools",
    descriptionKey: "One line per tool this session can call.",
    functional: false,
  },
  rules: {
    tag: "rules",
    labelKey: "Guidelines",
    descriptionKey: "Bullet list of rules, including each tool's own guidelines.",
    functional: false,
  },
  docs: {
    tag: "docs",
    labelKey: "Pi documentation",
    descriptionKey: "Pointers to pi's README, docs and examples.",
    functional: false,
  },
  addendum: {
    tag: "addendum",
    labelKey: "Append (tool notes)",
    descriptionKey: "Notes contributed by the enabled built-in tools. Removing it drops those instructions.",
    functional: true,
  },
  project_context: {
    tag: "project_context",
    labelKey: "Project context (AGENTS.md)",
    descriptionKey: "Contents of the AGENTS.md files found for the working directory. Removing it stops the model from seeing them.",
    functional: true,
  },
  skills: {
    tag: "skills",
    labelKey: "Skills",
    descriptionKey: "The available Skill listing. Removing it disables skill discovery.",
    functional: true,
  },
  model: {
    tag: "model",
    labelKey: "Model",
    descriptionKey: "The model this session is using.",
    functional: false,
  },
  thinking_level: {
    tag: "thinking_level",
    labelKey: "Thinking level",
    descriptionKey: "The session's thinking level.",
    functional: false,
  },
  date: {
    tag: "date",
    labelKey: "Date",
    descriptionKey: "Today's date.",
    functional: false,
  },
};

/** Catalog order: pi's own section order first, then Pi Work's additions. */
export const TEMPLATE_VARIABLE_NAMES: readonly TemplateVariableName[] = [
  "preamble",
  "tools",
  "rules",
  "docs",
  "addendum",
  "project_context",
  "skills",
  "model",
  "thinking_level",
  "date",
];

const TEMPLATE_VARIABLE_SET: ReadonlySet<string> = new Set(TEMPLATE_VARIABLE_NAMES);

/** Variables whose removal the settings UI must warn about — the catalog's
 *  `functional` flag is the single source of truth. */
export function functionalTemplateVariables(): TemplateVariableName[] {
  return TEMPLATE_VARIABLE_NAMES.filter((name) => TEMPLATE_VARIABLES[name].functional);
}

// ── Default template ──────────────────────────────────────────────────────

/** pi's native section order, as fragments. No `cwd` (pi appends it itself), no
 *  `model` / `thinking_level` / `date` (pi has no such sections). */
export const DEFAULT_SYSTEM_PROMPT_TEMPLATE: SystemPromptTemplate = [
  { id: "default-preamble", kind: "variable", name: "preamble" },
  { id: "default-tools", kind: "variable", name: "tools" },
  { id: "default-rules", kind: "variable", name: "rules" },
  { id: "default-docs", kind: "variable", name: "docs" },
  { id: "default-addendum", kind: "variable", name: "addendum" },
  { id: "default-project-context", kind: "variable", name: "project_context" },
  { id: "default-skills", kind: "variable", name: "skills" },
];

/** A fresh, mutable copy of the default template. */
export function createDefaultTemplate(): SystemPromptTemplate {
  return DEFAULT_SYSTEM_PROMPT_TEMPLATE.map((fragment) => ({ ...fragment }));
}

// ── Sanitising config.yaml input ──────────────────────────────────────────

/** pi's own section-name rule (`dist/core/system-prompt.js`). A text fragment
 *  whose tag breaks it falls back to an untagged fragment. */
const SECTION_NAME_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * Turn whatever `config.yaml` holds into a usable template. Deterministic and
 * idempotent: unknown fragments are dropped, missing ids are filled in from the
 * fragment's index, and invalid tags degrade to "no tag". A non-array (or a
 * hand-edited mess) becomes an empty template rather than a crash.
 */
export function normalizeSystemPromptTemplate(raw: unknown): SystemPromptTemplate {
  if (!Array.isArray(raw)) return [];
  const usedIds = new Set<string>();
  const out: SystemPromptTemplate = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const kind = record.kind;
    if (kind !== "text" && kind !== "variable") return;
    const fallbackId = `${kind}-${index}`;
    let id = typeof record.id === "string" && record.id.length > 0 ? record.id : fallbackId;
    if (usedIds.has(id)) id = `${id}-${index}`;
    usedIds.add(id);

    if (kind === "variable") {
      const name = record.name;
      if (typeof name !== "string" || !TEMPLATE_VARIABLE_SET.has(name)) return;
      out.push({ id, kind: "variable", name: name as TemplateVariableName });
      return;
    }

    if (typeof record.text !== "string") return;
    const tag =
      typeof record.tag === "string" && record.tag !== "preamble" && SECTION_NAME_RE.test(record.tag)
        ? record.tag
        : undefined;
    out.push(tag === undefined ? { id, kind: "text", text: record.text } : { id, kind: "text", tag, text: record.text });
  });
  return out;
}

// ── Render input ──────────────────────────────────────────────────────────

/** Structurally compatible with pi's `Skill`, so the SDK's object can be passed
 *  in without this module importing the SDK. */
export interface TemplateSkill {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

/**
 * Everything the variable values are built from. The server collects these from
 * the live session and the resource loader; nothing here is session-specific
 * beyond `cwd` / `model` / `thinkingLevel` / `date`.
 */
export interface TemplateMaterial {
  selectedTools: string[];
  toolSnippets: Record<string, string>;
  toolGuidelines: Record<string, string[]>;
  promptGuidelines?: string[];
  appendSystemPrompt: string;
  contextFiles: Array<{ path: string; content: string }>;
  skills: TemplateSkill[];
  cwd: string;
  docsPaths: { readme: string; docs: string; examples: string };
  model?: string;
  thinkingLevel?: string;
  date?: string;
}

/**
 * Build material with the empty defaults filled in, so the three producers (the
 * event options, the live session, and the no-session preview fallback) do not
 * each restate the whole field list. `cwd` is required; the docs paths have no
 * sensible default and are passed by whoever can reach the SDK.
 */
export function createTemplateMaterial(
  overrides: Partial<TemplateMaterial> & { cwd: string },
): TemplateMaterial {
  return {
    selectedTools: [],
    toolSnippets: {},
    toolGuidelines: {},
    promptGuidelines: [],
    appendSystemPrompt: "",
    contextFiles: [],
    skills: [],
    docsPaths: { readme: "", docs: "", examples: "" },
    ...overrides,
  };
}

/** pi's `_normalizePromptSnippet`: collapse to one trimmed line, or nothing. */
export function normalizePromptSnippet(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const oneLine = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return oneLine.length > 0 ? oneLine : undefined;
}

/** pi's `_normalizePromptGuidelines`: trimmed, de-duplicated, order kept. */
export function normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
  if (!guidelines || guidelines.length === 0) return [];
  const unique = new Set<string>();
  for (const guideline of guidelines) {
    const normalized = guideline.trim();
    if (normalized.length > 0) unique.add(normalized);
  }
  return Array.from(unique);
}

/** `provider/id`, the label the `model` variable renders. */
export function templateModelLabel(
  model: { provider: string; id: string } | undefined,
): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

/** Today, as `YYYY-MM-DD` in the local time zone. */
export function templateDate(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Per-variable bodies, untagged. An empty string means "this variable has
 *  nothing to say this turn" and drops the whole fragment at render time. */
export type TemplateVariableValues = Record<TemplateVariableName, string>;

// ── Copied from pi (see the header) ───────────────────────────────────────

const DEFAULT_PREAMBLE =
  "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

const TOOLS_TAIL =
  "In addition to the tools above, you may have access to other custom tools depending on the project.";

function docsBody(paths: TemplateMaterial["docsPaths"]): string {
  return `Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${paths.readme}
- Additional docs: ${paths.docs}
- Examples: ${paths.examples} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;
}

const RULE_BE_CONCISE = "Be concise in your responses";
const RULE_SHOW_PATHS = "Show file paths clearly when working with files";

/** pi's `buildRules`, copied. Shell rule first (only when a shell is active and
 *  no dedicated listing/searching tool is), then each active tool's guidelines
 *  in `selectedTools` order, then extension-contributed rules, then the two
 *  fixed rules. Trimmed-and-deduped, `- ` bullets, `\n`-joined. */
function buildRules(material: TemplateMaterial): string {
  const rules: string[] = [];
  const seen = new Set<string>();
  const addRule = (rule: string) => {
    const normalized = rule.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    rules.push(normalized);
  };

  const hasBash = material.selectedTools.includes("bash");
  const hasPowerShell = material.selectedTools.includes("powershell");
  const hasGrep = material.selectedTools.includes("grep");
  const hasFind = material.selectedTools.includes("find");
  const hasLs = material.selectedTools.includes("ls");

  if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
    if (hasBash && hasPowerShell) {
      addRule("Use bash or PowerShell for file operations like listing, searching, and finding files");
    } else if (hasPowerShell) {
      addRule("Use PowerShell for file operations like listing, searching, and finding files");
    } else {
      addRule("Use bash for file operations like ls, rg, find");
    }
  }

  for (const name of material.selectedTools) {
    for (const rule of material.toolGuidelines[name] ?? []) addRule(rule);
  }
  for (const rule of material.promptGuidelines ?? []) addRule(rule);
  addRule(RULE_BE_CONCISE);
  addRule(RULE_SHOW_PATHS);

  return rules.map((rule) => `- ${rule}`).join("\n");
}

/** pi's `renderProjectContext`, copied. */
function renderProjectContext(contextFiles: TemplateMaterial["contextFiles"]): string {
  return [
    "Project-specific instructions and guidelines:",
    ...contextFiles.map(
      ({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
    ),
  ].join("\n\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** pi's `formatSkillsForPrompt`, copied. Returns "" when no skill is visible to
 *  the model (every skill may opt out via `disableModelInvocation`). */
function formatSkillsForPrompt(skills: TemplateSkill[], fileReadTool: string): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
  if (visibleSkills.length === 0) return "";
  const lines = [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    fileReadTool === "read"
      ? "Use the read tool to load a skill's file when the task matches its description."
      : "Use bash to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ];
  for (const skill of visibleSkills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

// ── Rendering ─────────────────────────────────────────────────────────────

/** Cwd as pi renders it: backslashes normalised to forward slashes. */
export function normalizeTemplateCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/");
}

/**
 * Build every variable's body from raw material. Pure; the only impure part of
 * the pipeline (reading the session, the resource loader and pi's docs paths)
 * stays in `lib/server`.
 */
export function buildTemplateVariableValues(material: TemplateMaterial): TemplateVariableValues {
  const visibleTools = material.selectedTools.filter((name) => !!material.toolSnippets[name]);
  const tools =
    visibleTools.length === 0
      ? ""
      : `${visibleTools.map((name) => `- ${name}: ${material.toolSnippets[name]}`).join("\n")}\n\n${TOOLS_TAIL}`;

  const skillFileReadTool = ["read", "bash"].find((tool) => material.selectedTools.includes(tool));
  const skills =
    skillFileReadTool && material.skills.length > 0
      ? formatSkillsForPrompt(material.skills, skillFileReadTool).trim()
      : "";

  return {
    preamble: DEFAULT_PREAMBLE,
    tools,
    rules: buildRules(material),
    docs: docsBody(material.docsPaths),
    addendum: material.appendSystemPrompt,
    project_context: material.contextFiles.length > 0 ? renderProjectContext(material.contextFiles) : "",
    skills,
    model: material.model ?? "",
    thinking_level: material.thinkingLevel ?? "",
    date: material.date ?? "",
  };
}

function wrapTag(tag: string, body: string): string {
  return `<${tag}>\n${body}\n</${tag}>`;
}

/**
 * Render the template: fragments in order, non-empty bodies only, joined by
 * blank lines. A `text` fragment is emitted verbatim (wrapped only when it has
 * a tag); a variable is wrapped in its tag unless it is the untagged
 * `preamble`.
 */
export function renderSystemPromptTemplate(
  template: SystemPromptTemplate,
  values: Partial<TemplateVariableValues>,
): string {
  const parts: string[] = [];
  for (const fragment of template) {
    if (fragment.kind === "text") {
      if (fragment.text.trim() === "") continue;
      parts.push(fragment.tag ? wrapTag(fragment.tag, fragment.text) : fragment.text);
      continue;
    }
    const value = values[fragment.name] ?? "";
    if (value.trim() === "") continue;
    const tag = TEMPLATE_VARIABLES[fragment.name].tag;
    parts.push(tag === null ? value : wrapTag(tag, value));
  }
  return parts.join("\n\n");
}

/**
 * What the model actually receives: the rendered template plus the `<cwd>`
 * section pi appends unconditionally and last. There is no `cwd` variable, so
 * this is the one place order is not the user's to choose — a known, accepted
 * exception.
 *
 * **Do not put this string into `customPrompt`**: pi would append a second
 * `<cwd>`. The takeover writes the bare {@link renderSystemPromptTemplate}
 * output and lets pi add the section; this composed form is the read-side
 * source (Context panel / `get_state` / BTW) and is pinned against
 * `buildSystemPrompt` with `customPrompt` set by a unit test.
 *
 * An empty render is the one case with no cwd: the server forces an empty
 * prompt there (`forceSystemPrompt: ""`), because an empty `customPrompt` would
 * silently fall back to pi's own sections.
 */
export function composeSystemPrompt(rendered: string, cwd: string): string {
  if (rendered === "") return "";
  return `${rendered}\n\n${wrapTag("cwd", normalizeTemplateCwd(cwd))}`;
}

/** The `systemPromptOptions` fields the takeover patches. Mutated in place on
 *  the `before_agent_start` event — returning `{ systemPrompt }` instead would
 *  set `forceSystemPrompt` and let the transcript diverge from what the model
 *  sees, which is exactly what `customPrompt` avoids. */
export interface SystemPromptOptionsPatch {
  customPrompt: string;
  appendSystemPrompt: string;
  contextFiles: Array<{ path: string; content: string }>;
  skills: TemplateSkill[];
  sections: Record<string, string>;
}

/**
 * The patch shape, frozen by a test: Pi Work's render goes in as `customPrompt`
 * (which makes pi drop its own `<tools>` / `<rules>` / `<docs>`), and the four
 * fields pi would otherwise fill from the loader are cleared so nothing is
 * appended twice. `selectedTools` is deliberately left alone — pi reads it back
 * to apply the live tool loadout.
 */
export function planSystemPromptOptions(rendered: string): SystemPromptOptionsPatch {
  return {
    customPrompt: rendered,
    appendSystemPrompt: "",
    contextFiles: [],
    skills: [],
    sections: {},
  };
}

// ── Warnings ──────────────────────────────────────────────────────────────

export type TemplateWarning =
  | { code: "removed-functional-variable"; variable: TemplateVariableName }
  | { code: "empty-render" };

/**
 * What the settings UI must warn about before saving: a removed variable that
 * silently disables a feature, and a template that renders to nothing.
 */
export function findTemplateWarnings(
  template: SystemPromptTemplate,
  rendered: string,
): TemplateWarning[] {
  const present = new Set(template.filter((f) => f.kind === "variable").map((f) => f.name));
  const warnings: TemplateWarning[] = [];
  for (const variable of functionalTemplateVariables()) {
    if (!present.has(variable)) warnings.push({ code: "removed-functional-variable", variable });
  }
  if (rendered.trim() === "") warnings.push({ code: "empty-render" });
  return warnings;
}
