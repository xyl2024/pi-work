import { joinFilePath, normalizeFilePathSlashes } from "@/lib/shared/file-paths";

export interface SlashQuery {
  start: number;
  query: string;
}

export interface MentionQuery {
  start: number;
  query: string;
  directory: string;
}

export function getSlashQuery(value: string, cursor: number): SlashQuery | null {
  if (cursor === 0) return null;
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/\/([^\s/]*)$/);
  if (!match) return null;
  const start = match.index!;
  if (start >= 2 && value.slice(start - 2, start + 1) === "://") return null;
  return {
    start,
    query: match[1],
  };
}

export function getMentionQuery(value: string, cursor: number): MentionQuery | null {
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s]*)$/);
  if (!match) return null;
  const start = (match.index ?? 0) + match[1].length;
  const raw = match[2].replace(/\\/g, "/");
  const parts = raw.split("/");
  const last = parts.pop() ?? "";
  const directoryParts = parts.filter(Boolean);
  return { start, query: last, directory: directoryParts.join("/") };
}

export function resolveMentionDirectory(cwd: string, directory: string): string | null {
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/+$/, "");
  if (!directory) return normalizedCwd;
  const candidate = normalizeFilePathSlashes(joinFilePath(normalizedCwd, directory));
  return isPathInsideCwd(normalizedCwd, candidate) ? candidate : null;
}

export function isPathInsideCwd(cwd: string, path: string): boolean {
  const base = normalizeFilePathSlashes(cwd).replace(/\/+$/, "");
  const candidate = normalizeFilePathSlashes(path).replace(/\/+$/, "");
  return candidate === base || candidate.startsWith(`${base}/`);
}
