export interface ToolDiffStats {
  additions: number;
  deletions: number;
}

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
  }
  return { additions, deletions };
}

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

export function extractEditDiffStats(details: unknown): ToolDiffStats | null {
  if (!isObject(details)) return null;
  const patch = details["patch"];
  if (typeof patch === "string" && patch.length > 0) return countUnifiedPatchLines(patch);
  const diff = details["diff"];
  if (typeof diff === "string" && diff.length > 0) return countDisplayDiffLines(diff);
  return null;
}

function countContentLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

export function extractWriteDiffStats(input: Record<string, unknown> | undefined): ToolDiffStats | null {
  const content = input?.["content"];
  if (typeof content !== "string") return null;
  return { additions: countContentLines(content), deletions: 0 };
}

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
