// ============================================================================
// System prompt segmentation (pure)
//
// pi assembles the system prompt from several sources: the base prompt (tool
// snippets, guidelines, the pi docs pointer, the current working directory),
// the user's APPEND_SYSTEM.md, the `<available_skills>` listing, and one
// `<project_instructions path="…">` block per AGENTS.md-class file. This module
// is the single place that knows where those boundaries are.
//
// Two consumers want two different things from the same boundaries:
//
//  - the Context panel renders the prompt section by section, so it wants the
//    *display* slices (`text`; the AGENTS.md wrapper newlines are stripped) and
//    a stable anchor id per section;
//  - `context-composition` counts tokens per section, and BPE re-merges tokens
//    across a boundary, so counting each slice in isolation does not add up to
//    the whole. Instead it tokenizes the *original* string's prefixes and
//    subtracts (`prefix differencing`, ADR-0005) — which needs `start` / `end`
//    offsets into the original string, with the slices forming an ordered,
//    non-overlapping, gap-free cover of it.
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

/** A slice of the base prompt cut at its known section headings, with the
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
 *  `Current working directory:` footer — that one gets its own leaf (`id: "cwd"`)
 *  so the composition panel can show it as its own line even when nothing else
 *  separates it from the pi-docs section. */
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

// ── Top-level split: base text vs project-instruction blocks ──────────────
// pi's SDK wraps each AGENTS.md file in `<project_instructions path="…">`
// tags, so those tags are our only reliable per-source boundary.

/** Split a fully-assembled system prompt into its `base` and `agents` slices. */
export function splitSystemPrompt(systemPrompt: string): SystemPromptSegment[] {
  const segments: SystemPromptSegment[] = [];
  const re = /<project_instructions path="([^"]+)">([\s\S]*?)<\/project_instructions>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(systemPrompt)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "base", start: lastIndex, end: match.index, text: systemPrompt.slice(lastIndex, match.index) });
    }
    // pi's buildSystemPrompt wraps content as `<tag>\n${content}\n</tag>`;
    // strip the wrapper-introduced leading/trailing newlines so the rendered
    // segment matches the original file rather than the assembly scaffolding.
    segments.push({
      kind: "agents",
      path: match[1],
      start: match.index,
      end: match.index + match[0].length,
      text: match[2].replace(/^\n+|\n+$/g, ""),
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < systemPrompt.length) {
    segments.push({ kind: "base", start: lastIndex, end: systemPrompt.length, text: systemPrompt.slice(lastIndex) });
  }
  return segments;
}

// ── Fine-grained anchors inside the base prompt ───────────────────────────
// The pi base prompt is a flat text blob; we cut it at its known section
// headings so the context panel can offer per-section jump targets (Available
// tools / Guidelines / Pi documentation / Append) instead of only the whole
// base block. Parsing is defensive: headings that aren't found simply yield no
// anchor, and a custom-prompt setup that matches nothing falls back to the
// whole-block base anchor.

const BASE_HEADING_ANCHORS: Array<{ id: string; re: RegExp }> = [
  { id: "available-tools", re: /Available tools:/ },
  { id: "guidelines", re: /Guidelines:/ },
  { id: "pi-docs", re: /Pi documentation/ },
];

/** Detect the `<available_skills>…</available_skills>` listing that pi injects
 *  into its base prompt, so the context panel can offer a dedicated jump
 *  target and highlight each skill's `<name>` line. */
const SKILLS_SECTION_RE = /<available_skills>[\s\S]*?<\/available_skills>/;

/** Where the skills listing really starts: `formatSkillsForPrompt` emits a
 *  short "The following skills provide…" preamble right before the tag, and
 *  the composition bucket is the whole listing (preamble included, ADR-0005),
 *  not just the tag. Falls back to the tag when the preamble is absent. */
const SKILLS_PREAMBLE = "\n\nThe following skills provide specialized instructions";

function skillsSectionStart(text: string, tagIndex: number): number {
  const preambleIndex = text.lastIndexOf(SKILLS_PREAMBLE, tagIndex);
  // Skip the blank-line separator; the leaf starts at the sentence itself.
  return preambleIndex < 0 ? tagIndex : preambleIndex + 2;
}

/** pi always terminates the assembled prompt with `\nCurrent working
 *  directory: <cwd>` (`dist/core/system-prompt.js` — both the custom-prompt and
 *  the built-in branch). It is its own composition leaf so "current working
 *  directory" is a line the user can read off directly. */
const CWD_LEAF_RE = /\nCurrent working directory: [^\n]*\n?$/;

/** Index just after pi's "Always read pi .md files…" line (the end of the
 *  Pi documentation section). `-1` when the pi docs section is absent. */
function findPiDocsEnd(text: string): number {
  const m = /Always read pi\s*\.md files[^\n]*/.exec(text);
  return m ? m.index + m[0].length : -1;
}

/** Non-whitespace (non-cwd) content still following the pi docs section —
 *  i.e. the user's APPEND_SYSTEM.md block. */
function hasAppendSection(text: string, after: number): boolean {
  const rest = text.slice(after).replace(/\nCurrent working directory:[\s\S]*$/, "");
  return rest.trim().length > 0;
}

/**
 * Slice the base prompt into anchorable blocks at its known headings.
 * `offset` is added to every returned boundary, so a block cut out of a base
 * segment carries offsets into the original system prompt.
 */
export function splitBaseBlocks(text: string, offset = 0): BasePromptBlock[] {
  const marks: Array<{ index: number; id: string }> = [];
  for (const { id, re } of BASE_HEADING_ANCHORS) {
    const m = re.exec(text);
    if (m) marks.push({ index: m.index, id });
  }
  const piDocsEnd = findPiDocsEnd(text);
  if (piDocsEnd >= 0 && hasAppendSection(text, piDocsEnd)) {
    marks.push({ index: piDocsEnd, id: "append" });
  }
  const skillsMatch = SKILLS_SECTION_RE.exec(text);
  if (skillsMatch) marks.push({ index: skillsMatch.index, id: "skills" });
  marks.sort((a, b) => a.index - b.index);
  const blocks: BasePromptBlock[] = [];
  let cursor = 0;
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    if (mark.index > cursor) blocks.push({ anchor: null, start: offset + cursor, end: offset + mark.index, text: text.slice(cursor, mark.index) });
    blocks.push({ anchor: mark.id, start: offset + mark.index, end: offset + end, text: text.slice(mark.index, end) });
    cursor = end;
  }
  if (cursor < text.length) blocks.push({ anchor: null, start: offset + cursor, end: offset + text.length, text: text.slice(cursor) });
  return blocks;
}

/**
 * The ordered partition of the system prompt that `context-composition`
 * consumes: top-level segments, with base segments further cut at their
 * headings so the skills listing is its own leaf. The slices are contiguous
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
      if (block.anchor !== "skills") {
        push({
          id: block.anchor ?? `base:${leaves.length}`,
          kind: "base",
          start: block.start,
          end: block.end,
          text: block.text,
        });
        continue;
      }
      // The Context panel anchors the skills block at the `<available_skills>`
      // tag and lets it run to the next anchor, but the composition bucket is
      // the whole listing — preamble included, stopping at `</available_skills>`
      // (ADR-0005) — and the trailing text (the cwd line) belongs to the system
      // prompt. Split that boundary out here and keep the partition tiling.
      const match = SKILLS_SECTION_RE.exec(systemPrompt.slice(block.start, block.end));
      const skillsEnd = match ? block.start + match[0].length : block.end;
      const skillsStart = skillsSectionStart(systemPrompt, block.start);
      const previous = leaves[leaves.length - 1];
      if (previous && previous.end > skillsStart) {
        previous.end = skillsStart;
        previous.text = systemPrompt.slice(previous.start, skillsStart);
      }
      push({
        id: "skills",
        kind: "skills",
        start: skillsStart,
        end: skillsEnd,
        text: systemPrompt.slice(skillsStart, skillsEnd),
      });
      push({
        id: `base:${leaves.length}`,
        kind: "base",
        start: skillsEnd,
        end: block.end,
        text: systemPrompt.slice(skillsEnd, block.end),
      });
    }
  }
  // Carve the trailing `Current working directory:` footer out of the last
  // base leaf. Without this it is glued to whatever block happens to precede it
  // (the pi-docs section when there are no skills / project files, the
  // `</project_context>` wrapper when there are) and the composition cannot
  // report it as its own source. Only `base` tails qualify: an AGENTS.md file
  // whose content ends with such a line is file content, not the footer.
  const tail = leaves[leaves.length - 1];
  if (tail && tail.kind === "base") {
    const tailEnd = tail.end;
    const match = CWD_LEAF_RE.exec(systemPrompt.slice(tail.start, tailEnd));
    if (match) {
      const cwdStart = tail.start + match.index;
      tail.end = cwdStart;
      tail.text = systemPrompt.slice(tail.start, cwdStart);
      leaves.push({
        id: "cwd",
        kind: "base",
        start: cwdStart,
        end: tailEnd,
        text: systemPrompt.slice(cwdStart, tailEnd).replace(/^\n+|\n+$/g, ""),
      });
    }
  }

  // A shrunk filler can end up zero-length; the partition only keeps real ones.
  return leaves.filter((leaf) => leaf.end > leaf.start);
}
