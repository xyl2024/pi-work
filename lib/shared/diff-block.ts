import {
  countDisplayDiffLines,
  countUnifiedPatchLines,
  sumDiffStats,
  type ToolDiffStats,
} from "./tool-diff-stats";

export type DiffLineType = "file" | "hunk" | "add" | "del" | "context" | "meta";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
  oldStart?: number;
  oldCount?: number;
  newStart?: number;
  newCount?: number;
}

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

export interface DiffParseResult {
  renderable: boolean;
  hasHunks: boolean;
  files: DiffFile[];
  additions: number;
  deletions: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const META_PREFIXES = [
  "index ",
  "old mode ",
  "new mode ",
  "new file mode ",
  "deleted file mode ",
  "similarity index ",
  "dissimilarity index ",
  "copy from ",
  "copy to ",
  "Binary files ",
];


const DIFF_GIT_PREFIX = "diff --git ";

function fileSegments(text: string): string[] {
  const segments: string[][] = [];
  for (const raw of text.split("\n")) {
    if (raw.startsWith(DIFF_GIT_PREFIX) || segments.length === 0) {
      segments.push([raw]);
    } else {
      segments[segments.length - 1].push(raw);
    }
  }
  return segments.map((lines) => lines.join("\n"));
}

function overallStats(text: string): ToolDiffStats {
  const perFile = fileSegments(text).map((segment) => {
    const hasHunk = segment.split("\n").some((line) => HUNK_HEADER.test(line));
    if (hasHunk) return countUnifiedPatchLines(segment);
    return countDisplayDiffLines(
      segment
        .split("\n")
        .filter((line) => !line.startsWith("--- ") && !line.startsWith("+++ "))
        .join("\n"),
    );
  });
  return sumDiffStats(perFile) ?? { additions: 0, deletions: 0 };
}

const RENAME_PREFIXES = ["rename from ", "rename to "];

function stripPathPrefix(path: string): string | null {
  if (path === "/dev/null") return null;
  return path.replace(/^(a|b)\//, "");
}

function emptyFile(oldPath: string | null, newPath: string | null): DiffFile {
  return { oldPath, newPath, lines: [], additions: 0, deletions: 0 };
}

function parseHunkHeader(
  line: string,
): Pick<DiffLine, "oldStart" | "oldCount" | "newStart" | "newCount"> | null {
  const match = HUNK_HEADER.exec(line);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
  };
}

interface ParseState {
  current: DiffFile;
  files: DiffFile[];
  additions: number;
  deletions: number;
  oldNo: number;
  newNo: number;
}

function ensureFile(state: ParseState, oldPath: string | null, newPath: string | null): DiffFile {
  if (state.current.lines.length === 0 && state.current.oldPath === null && state.current.newPath === null) {
    state.current.oldPath = oldPath;
    state.current.newPath = newPath;
    return state.current;
  }
  const file = emptyFile(oldPath, newPath);
  state.files.push(file);
  state.current = file;
  return file;
}

function push(state: ParseState, line: DiffLine): void {
  state.current.lines.push(line);
  if (line.type === "add") {
    state.additions++;
    state.current.additions++;
  } else if (line.type === "del") {
    state.deletions++;
    state.current.deletions++;
  }
}

function getFile(state: ParseState): DiffFile {
  return state.current;
}

export function parseDiffBlock(text: string): DiffParseResult {
  const state: ParseState = {
    current: emptyFile(null, null),
    files: [],
    additions: 0,
    deletions: 0,
    oldNo: 0,
    newNo: 0,
  };
  state.files.push(state.current);

  for (const raw of text.split("\n")) {
    if (raw.startsWith(DIFF_GIT_PREFIX)) {
      const paths = raw.slice(DIFF_GIT_PREFIX.length).split(" ");
      const hasOld = paths[0]?.startsWith("a/");
      const hasNew = paths[1]?.startsWith("b/");
      ensureFile(
        state,
        hasOld ? stripPathPrefix(paths[0]) : null,
        hasNew ? stripPathPrefix(paths[1]) : null,
      );
      push(state, { type: "file", text: raw.slice(DIFF_GIT_PREFIX.length) });
      continue;
    }
    if (raw.startsWith(RENAME_PREFIXES[0])) {
      getFile(state).oldPath = stripPathPrefix(raw.slice(RENAME_PREFIXES[0].length));
      push(state, { type: "meta", text: raw });
      continue;
    }
    if (raw.startsWith(RENAME_PREFIXES[1])) {
      getFile(state).newPath = stripPathPrefix(raw.slice(RENAME_PREFIXES[1].length));
      push(state, { type: "meta", text: raw });
      continue;
    }
    if (raw.startsWith("@@")) {
      const header = parseHunkHeader(raw);
      if (header) {
        state.oldNo = header.oldStart ?? 0;
        state.newNo = header.newStart ?? 0;
        push(state, { type: "hunk", text: "", ...header });
      } else {
        push(state, { type: "meta", text: raw });
      }
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      const path = stripPathPrefix(raw.slice(4).trim());
      const isDelSide = raw.startsWith("--- ");
      const file = getFile(state);
      const hasBody = file.lines.some((l) => l.type !== "file" && l.type !== "meta");
      if (!hasBody) {
        if (isDelSide) file.oldPath = path;
        else file.newPath = path;
      }
      push(state, { type: "meta", text: raw });
      continue;
    }
    if (raw.startsWith("\\") || META_PREFIXES.some((p) => raw.startsWith(p))) {
      push(state, { type: "meta", text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      push(state, { type: "add", text: raw.slice(1), newLine: state.newNo > 0 ? state.newNo : undefined });
      if (state.newNo > 0) state.newNo++;
      continue;
    }
    if (raw.startsWith("-")) {
      push(state, { type: "del", text: raw.slice(1), oldLine: state.oldNo > 0 ? state.oldNo : undefined });
      if (state.oldNo > 0) state.oldNo++;
      continue;
    }
    const text = raw.startsWith(" ") ? raw.slice(1) : raw;
    push(state, {
      type: "context",
      text,
      oldLine: state.oldNo > 0 ? state.oldNo : undefined,
      newLine: state.newNo > 0 ? state.newNo : undefined,
    });
    if (state.oldNo > 0) state.oldNo++;
    if (state.newNo > 0) state.newNo++;
  }

  const renderable = state.additions > 0 || state.deletions > 0;
  const hasHunks = state.files.some((f) => f.lines.some((l) => l.type === "hunk"));
  const stats = overallStats(text);
  if (!renderable) {
    return { renderable: false, hasHunks, files: [], additions: 0, deletions: 0 };
  }
  return {
    renderable: true,
    hasHunks,
    files: state.files,
    additions: stats.additions,
    deletions: stats.deletions,
  };
}
