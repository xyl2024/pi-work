// Client-safe parser that turns a unified diff into per-line gutter marks
// for the FileViewer (VS Code style). No server-only imports here — mirror
// the pattern in git-diff-types.ts.

export type GitLineMarkType = "added" | "modified";

export interface GitDeletedBlock {
  /** Insert the deletion marker before this 1-indexed line of the current
   *  file. `lines.length + 1` (or beyond) means end of file. */
  beforeLine: number;
  /** Removed lines (content only, no `-` prefix). */
  lines: string[];
}

export interface ParsedFileDiff {
  /** Current-file line number → mark type. */
  lineMarks: Map<number, GitLineMarkType>;
  /** Removed blocks in display order (ascending beforeLine). */
  deletedBlocks: GitDeletedBlock[];
}

/**
 * Parse a unified diff into per-line marks. Adjacent removed+added pairs
 * (a modification) mark the added lines as "modified"; standalone added
 * blocks mark "added". Removed lines are collected into deleted blocks
 * anchored at the position where they belonged in the current file.
 *
 * Untracked files arrive as `diff --no-index /dev/null <file>` — a single
 * hunk with only added lines, so every line comes out "added" (all green),
 * which is the desired behaviour for brand-new files.
 */
export function parseFileDiff(diff: string): ParsedFileDiff {
  const lineMarks = new Map<number, GitLineMarkType>();
  const deletedBlocks: GitDeletedBlock[] = [];

  let inHunk = false;
  /** Running line number in the new (current) file. */
  let newLineNo = 0;
  /** Removed lines not yet attached to a block (adjacent to the current
   *  added block, or awaiting a context/anchor line). */
  let pendingRemoved: string[] = [];
  /** First line of the current added block — anchor for a modification's
   *  deleted lines. */
  let addedBlockStart: number | null = null;

  const flushRemoved = (anchor: number) => {
    if (pendingRemoved.length > 0) {
      deletedBlocks.push({ beforeLine: anchor, lines: pendingRemoved });
      pendingRemoved = [];
    }
    addedBlockStart = null;
  };

  for (const raw of diff.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("@@")) {
      // New hunk: anchor any dangling removed lines at the previous hunk's
      // tail, then reset the new-file line counter from the hunk header.
      flushRemoved(addedBlockStart ?? newLineNo + 1);
      inHunk = true;
      const m = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      newLineNo = m ? parseInt(m[1], 10) - 1 : newLineNo;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const c = line.charAt(0);
    if (c === " ") {
      // Context line — a dangling removed block sits right before it.
      newLineNo++;
      flushRemoved(addedBlockStart ?? newLineNo);
    } else if (c === "-") {
      pendingRemoved.push(line.slice(1));
    } else if (c === "+") {
      newLineNo++;
      if (addedBlockStart === null) addedBlockStart = newLineNo;
      // Adjacent removed+added pair = modification; standalone = addition.
      lineMarks.set(newLineNo, pendingRemoved.length > 0 ? "modified" : "added");
    }
  }
  // Trailing removed block at the end of the diff (or end of a hunk).
  if (pendingRemoved.length > 0) {
    deletedBlocks.push({ beforeLine: addedBlockStart ?? newLineNo + 1, lines: pendingRemoved });
  }

  return { lineMarks, deletedBlocks };
}
