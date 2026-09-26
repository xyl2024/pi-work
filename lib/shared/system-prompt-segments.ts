// ============================================================================
// System prompt segmentation (pure)
//
// pi assembles the system prompt as an untagged persona paragraph followed by
// a sequence of tagged sections — `<tools>…</tools>`, `<rules>…</rules>`,
// `<docs>…</docs>`, `<addendum>…</addendum>`, `<project_context>…</…>`,
// `<skills>…</skills>`, `<cwd>…</cwd>` — joined by blank lines. The tags are
// the section boundaries (`dist/core/system-prompt.js#buildSystemPromptSections`),
// which is what this module cuts on.
//
// Three consumers want three different things from the same boundaries:
//
//  - the Context panel renders the prompt section by section, so it wants the
//    *display* slices (`text`; the `<name>` / `</name>` scaffolding stripped)
//    and a stable anchor id per section;
//  - `context-composition` counts tokens per section, and BPE re-merges tokens
//    across a boundary, so counting each slice in isolation does not add up to
//    the whole. Instead it tokenizes the *original* string's prefixes and
//    subtracts (`prefix differencing`, ADR-0005) — which needs `start` / `end`
//    offsets into the original string, with the slices forming an ordered,
//    non-overlapping, gap-free cover of it;
//  - the specialized-subagent path and the `load_pi_docs` toggle rewrite the
//    rendered prompt, so they want to drop or unwrap a section by name.
//
// So: offsets always cover the original bytes (tags included); `text` is what
// the panel draws.
//
// Like `panelTabs` / `chat-timeline` / `tool-call-display` (ADR-0002 /
// ADR-0003) this module may not import React, DOM, i18n, a client hook, or
// anything from `lib/server`.
// ============================================================================

/** A top-level slice of the assembled system prompt: a run of literal text
 *  (`base`) or one `<project_instructions path="…">` block (`agents`).
 *
 *  `start` / `end` are offsets into the *original* prompt and cover the AGENTS
 *  wrapper tags; `text` is the display slice, i.e. the inner content with the
 *  wrapper-introduced leading/trailing newlines stripped. */
export type SystemPromptSegment =
  | { kind: "base"; start: number; end: number; text: string }
  | { kind: "agents"; path: string; start: number; end: number; text: string };

/** A slice of the base prompt cut at its known section tags, with the
 *  absolute offsets of that slice in the original system prompt. */
export type BasePromptBlock = {
  /** data-context-anchor id; null for unanchored filler. */
  anchor: string | null;
  start: number;
  end: number;
  text: string;
};

/** What a composition leaf came from. Only `skills` is carved out into its own
 *  top-level bucket today; `base` / `agents` stay inside the system prompt.
 *
 *  `base` covers everything the base prompt contributed, including the trailing
 *  working directory — that one gets its own leaf (`id: "cwd"`) so the
 *  composition panel can show it as its own line. */
export type SystemPromptLeafKind = "base" | "skills" | "agents";

/** One leaf of the system prompt partition used by `context-composition`. */
export interface SystemPromptLeaf {
  /** Stable id — the Context-panel anchor for anchorable blocks, an
   *  `agents:<path>` id for project-instruction files, `base:<n>` otherwise. */
  id: string;
  kind: SystemPromptLeafKind;
  /** Absolute offsets into the original system prompt. */
  start: number;
  end: number;
  /** Display text (same slices the Context panel renders). */
  text: string;
  /** Source path, for `agents` leaves only. */
  path?: string;
}

// ── Section tags ──────────────────────────────────────────────────────────
// pi's section name → the Context-panel anchor id it renders as. The panel's
// vocabulary predates the tags (it still calls the tool list "available-tools",
// the rules "guidelines" and the append block "append"), so the names are
// translated rather than renamed.

const SECTION_ANCHORS: Record<string, string> = {
  tools: "available-tools",
  rules: "guidelines",
  docs: "pi-docs",
  addendum: "append",
  skills: "skills",
  cwd: "cwd",
};

/** One tagged section, tags included. `tools|rules|docs` are absent when the
 *  session runs with a custom prompt; `addendum|project_context|skills` are
 *  absent when their source is empty. */
const SECTION_RE = /<(tools|rules|docs|addendum|skills|cwd)>\n([\s\S]*?)\n<\/\1>/g;

/** `<project_context>` is pi scaffolding wrapped around the AGENTS.md files;
 *  the wrapper lines are dropped from the display text. */
const PROJECT_CONTEXT_WRAPPER_RE = /<project_context>\n|\n<\/project_context>/g;

/** pi's SDK wraps each AGENTS.md file in `<project_instructions path="…">`
 *  tags, so those tags are our only reliable per-source boundary. */
const PROJECT_INSTRUCTIONS_RE = /<project_instructions path="([^"]+)">([\s\S]*?)<\/project_instructions>/g;

/** The `<project_context>` section as a whole, so its wrapper can be dropped
 *  and the project-instruction files carved out with correct offsets. */
const PROJECT_CONTEXT_RE = /<project_context>\n([\s\S]*?)\n<\/project_context>/g;

// ── Top-level split: base text vs project-instruction blocks ──────────────

/** Split a fully-assembled system prompt into its `base` and `agents` slices.
 *  The `<project_context>` wrapper is pi scaffolding, not content: it is left
 *  out of the `base` slices and only its `<project_instructions>` blocks
 *  survive as `agents` segments. */
export function splitSystemPrompt(systemPrompt: string): SystemPromptSegment[] {
  const segments: SystemPromptSegment[] = [];
  const pushBase = (start: number, end: number) => {
    if (end <= start) return;
    // Merge with the previous base run so the filler between two AGENTS.md
    // files does not become a segment of its own.
    const last = segments[segments.length - 1];
    if (last && last.kind === "base" && last.end === start) {
      last.end = end;
      last.text = systemPrompt.slice(last.start, end);
      return;
    }
    segments.push({ kind: "base", start, end, text: systemPrompt.slice(start, end) });
  };

  let cursor = 0;
  PROJECT_CONTEXT_RE.lastIndex = 0;
  let section: RegExpExecArray | null;
  while ((section = PROJECT_CONTEXT_RE.exec(systemPrompt)) !== null) {
    const sectionEnd = section.index + section[0].length;
    const contentStart = section.index + "<project_context>\n".length;
    // Everything up to and including the `<project_context>` line is base
    // text; `splitBaseBlocks` strips that wrapper line for display.
    pushBase(cursor, contentStart);

    const content = section[1];
    let innerCursor = contentStart;
    PROJECT_INSTRUCTIONS_RE.lastIndex = 0;
    let inner: RegExpExecArray | null;
    while ((inner = PROJECT_INSTRUCTIONS_RE.exec(content)) !== null) {
      const start = contentStart + inner.index;
      const end = start + inner[0].length;
      pushBase(innerCursor, start);
      // pi's buildSystemPrompt wraps content as `<tag>\n${content}\n</tag>`;
      // strip the wrapper-introduced leading/trailing newlines so the rendered
      // segment matches the original file rather than the assembly scaffolding.
      segments.push({
        kind: "agents",
        path: inner[1],
        start,
        end,
        text: inner[2].replace(/^\n+|\n+$/g, ""),
      });
      innerCursor = end;
    }
    // Trailing filler plus the `</project_context>` line (stripped on display).
    pushBase(innerCursor, sectionEnd);
    cursor = sectionEnd;
  }
  pushBase(cursor, systemPrompt.length);
  return segments;
}

// ── Fine-grained anchors inside the base prompt ───────────────────────────

/**
 * Slice the base prompt into anchorable blocks at its section tags. `offset`
 * is added to every returned boundary, so a block cut out of a base segment
 * carries offsets into the original system prompt.
 *
 * An anchored block's offsets cover the `<name>` / `</name>` scaffolding while
 * its `text` is the inner content, which is what lets the panel show the
 * section body without the XML and still keep the partition exact.
 */
export function splitBaseBlocks(text: string, offset = 0): BasePromptBlock[] {
  const blocks: BasePromptBlock[] = [];
  const pushFiller = (start: number, end: number) => {
    if (end <= start) return;
    blocks.push({
      anchor: null,
      start: offset + start,
      end: offset + end,
      // The `<project_context>` wrapper line has no anchor of its own; drop it
      // rather than rendering pi's scaffolding as if it were content.
      text: text.slice(start, end).replace(PROJECT_CONTEXT_WRAPPER_RE, ""),
    });
  };

  SECTION_RE.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = SECTION_RE.exec(text)) !== null) {
    const start = match.index;
    pushFiller(cursor, start);
    blocks.push({
      anchor: SECTION_ANCHORS[match[1]] ?? null,
      start: offset + start,
      end: offset + start + match[0].length,
      text: match[2],
    });
    cursor = start + match[0].length;
  }
  pushFiller(cursor, text.length);
  return blocks;
}

/**
 * The ordered partition of the system prompt that `context-composition`
 * consumes: top-level segments, with base segments further cut at their section
 * tags so the skills listing is its own leaf. The slices are contiguous
 * (`leaf[i].end === leaf[i + 1].start`) and cover the whole string, which is
 * what makes prefix differencing add up to `countTokens(systemPrompt)` exactly.
 */
export function splitSystemPromptLeaves(systemPrompt: string): SystemPromptLeaf[] {
  const leaves: SystemPromptLeaf[] = [];
  const push = (leaf: SystemPromptLeaf) => {
    if (leaf.end > leaf.start) leaves.push(leaf);
  };

  for (const segment of splitSystemPrompt(systemPrompt)) {
    if (segment.kind === "agents") {
      push({
        id: `agents:${segment.path}`,
        kind: "agents",
        start: segment.start,
        end: segment.end,
        text: segment.text,
        path: segment.path,
      });
      continue;
    }
    for (const block of splitBaseBlocks(segment.text, segment.start)) {
      // The whole `<skills>…</skills>` section is the skills bucket (ADR-0005),
      // not just the `<available_skills>` tag inside it.
      if (block.anchor === "skills") {
        push({
          id: "skills",
          kind: "skills",
          start: block.start,
          end: block.end,
          text: block.text,
        });
        continue;
      }
      push({
        id: block.anchor ?? `base:${leaves.length}`,
        kind: "base",
        start: block.start,
        end: block.end,
        text: block.text,
      });
    }
  }
  return leaves;
}

// ── Rewriting the rendered prompt ─────────────────────────────────────────

/** One `<name>…</name>` section, the blank lines that separate it from its
 *  neighbours included. `name` is a literal pi section name, never user input. */
function sectionRe(name: string): RegExp {
  return new RegExp(`\\n*<${name}>\\n([\\s\\S]*?)\\n</${name}>`, "g");
}

/** Remove a whole section (tags and body) from a rendered system prompt. */
export function dropSystemPromptSection(prompt: string, name: string): string {
  return prompt.replace(sectionRe(name), "");
}

/** Keep a section's body, replacing its scaffolding with `render(body)`. */
export function rewriteSystemPromptSection(
  prompt: string,
  name: string,
  render: (body: string) => string,
): string {
  return prompt.replace(sectionRe(name), (_match, body: string) => `\n\n${render(body)}\n`);
}

/**
 * Flatten pi's rendered prompt for a specialized subagent: drop the generic
 * persona paragraph, the "other custom tools" aside and the pi-docs pointer,
 * keep everything else, and restore the headings pi used before it tagged its
 * sections so the subagent prompts read as the flat text they were written
 * against.
 */
export function stripDefaultSystemPromptSections(prompt: string): string {
  let out = prompt
    .replace(
      /^You are an expert coding assistant operating inside pi, a coding agent harness\. You help users by reading files, executing commands, editing code, and writing new files\.\s*/,
      "",
    )
    .replace(
      /\nIn addition to the tools above, you may have access to other custom tools depending on the project\./,
      "",
    );
  // The pi-docs pointer is the one section a specialized subagent never needs.
  out = dropSystemPromptSection(out, "docs");
  out = rewriteSystemPromptSection(out, "tools", (body) => `Available tools:\n${body}`);
  out = rewriteSystemPromptSection(out, "rules", (body) => `Guidelines:\n${body}`);
  // Unwrapping cwd to a bare path would lose the "this is your cwd" framing.
  out = rewriteSystemPromptSection(out, "cwd", (body) => `Current working directory: ${body}`);
  for (const name of ["addendum", "project_context", "skills"]) {
    out = rewriteSystemPromptSection(out, name, (body) => body);
  }
  return out.trim();
}

/**
 * Remove ONLY pi's built-in "Pi documentation" section from a rendered system
 * prompt, leaving everything else (append blocks, `<project_context>`, skills,
 * working directory, …) untouched. The section is a tagged `<docs>` block, so
 * the tag is an exact boundary and the removal can never over-consume a
 * following section.
 *
 * Backed by `PiWorkConfig.load_pi_docs`: when the toggle is off, new sessions
 * start without the model being pointed at the pi SDK README / docs paths.
 */
export function stripPiDocumentationSection(prompt: string): string {
  return dropSystemPromptSection(prompt, "docs").trimStart();
}
