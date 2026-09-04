// Pure helpers that derive added/deleted line counts from edit / write tool
// data alone — no git, no fs. Safe for both client and server (lib/shared).
//
// Data sources:
// - edit → pi's `EditToolDetails { diff, patch, firstChangedLine }` on the
//   tool result message (`ToolResultMessage.details`). `patch` is a standard
//   unified patch; `diff` is pi's display format (`+<lineNum> <text>`).
// - write → the tool result carries no details, so counts are derived from
//   the tool call input (`{ path, content }`): additions = written line
//   count, deletions = 0 (the previous content is unknown without git).

export interface ToolDiffStats {
  additions: number;
  deletions: number;
}

/** Count added/deleted lines in a standard unified patch.
 *  Header lines (`---`, `+++`, `Index`, `===`) only appear before the first
 *  `@@` hunk, so anything before the first hunk header is skipped; that also
 *  keeps deleted content starting with `--` from being miscounted. */
export function countUnifiedPatchLines(patch: string): ToolDiffStats {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
    // `\ No newline at end of file` and context lines are ignored.
  }
  return { additions, deletions };
}

/** Count added/deleted lines in pi's display-oriented diff format, where the
 *  first character of every line is the marker: `+` / `-` / ` ` (context). */
export function countDisplayDiffLines(diff: string): ToolDiffStats {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/** Extract added/deleted line counts from an edit tool result's `details`
 *  payload. Prefers the unified `patch`; falls back to the display `diff`.
 *  Returns null when neither is present. */
export function extractEditDiffStats(details: unknown): ToolDiffStats | null {
  if (!isObject(details)) return null;
  const patch = details["patch"];
  if (typeof patch === "string" && patch.length > 0) return countUnifiedPatchLines(patch);
  const diff = details["diff"];
  if (typeof diff === "string" && diff.length > 0) return countDisplayDiffLines(diff);
  return null;
}

/** Count the number of lines in a written file's content. An empty string
 *  counts as 0 lines; a trailing newline does not start a new line. */
function countContentLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

/** Derive added/deleted line counts for a write tool call from its input.
 *  Deletions are always 0 — the overwritten content is not part of the
 *  tool call data (avoiding git). Returns null when there is no content. */
export function extractWriteDiffStats(input: Record<string, unknown> | undefined): ToolDiffStats | null {
  const content = input?.["content"];
  if (typeof content !== "string") return null;
  return { additions: countContentLines(content), deletions: 0 };
}

/** Extract the target file path from an edit/write tool call input. */
export function extractMutatingPath(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const p = input["path"] ?? input["file_path"];
  return typeof p === "string" ? p : "";
}

/** Sum a list of per-tool-call diff stats (null entries are ignored).
 *  Returns null when no entry carried data, so callers can distinguish
 *  "no edit/write data this turn" from an explicit +0/-0. */
export function sumDiffStats(list: Array<ToolDiffStats | null | undefined>): ToolDiffStats | null {
  let additions: number | null = null;
  let deletions: number | null = null;
  for (const item of list) {
    if (!item) continue;
    additions = (additions ?? 0) + item.additions;
    deletions = (deletions ?? 0) + item.deletions;
  }
  if (additions === null || deletions === null) return null;
  return { additions, deletions };
}
