import { getMentionQuery } from "@/lib/shared/composer-queries";
import { getRelativeFilePath, normalizeFilePathSlashes } from "@/lib/shared/file-paths";
import { insertNodes, insertText } from "./model";
import { projectDocText } from "./offsets";
import type { ComposerNode, ComposerState } from "./types";

export interface MentionEntry {
  name: string;
  fullPath: string;
  isDir: boolean;
  isParent?: boolean;
}

export function mentionTokenEnd(text: string, cursorOffset: number): number {
  const bounded = Math.max(0, Math.min(cursorOffset, text.length));
  return bounded + (text.slice(bounded).match(/^[^\s]*/)?.[0].length ?? 0);
}

export function mentionRelativeDirectory(cwd: string, absoluteDirectory: string): string {
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/+$/, "");
  const normalizedDirectory = normalizeFilePathSlashes(absoluteDirectory).replace(/\/+$/, "");
  if (normalizedDirectory === normalizedCwd) return "";
  return getRelativeFilePath(absoluteDirectory, cwd)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function filterMentionEntries(
  entries: MentionEntry[],
  query: string,
  cwd?: string,
): MentionEntry[] {
  const normalized = query.toLowerCase();
  if (!normalized) return entries;
  return entries.filter(
    (entry) =>
      entry.name.toLowerCase().includes(normalized)
      || getRelativeFilePath(entry.fullPath, cwd).toLowerCase().includes(normalized),
  );
}

export function parentMentionEntry(relativeDirectory: string): MentionEntry | null {
  const parts = relativeDirectory.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  parts.pop();
  return { name: "..", fullPath: parts.join("/"), isDir: true, isParent: true };
}

export function mentionDirectoryText(relativeDirectory: string, entry: MentionEntry): string {
  const parts = relativeDirectory.split("/").filter(Boolean);
  if (entry.isParent) parts.pop();
  else parts.push(entry.name);
  const relative = parts.join("/");
  return relative ? `@${relative}/` : "@";
}

function mentionRange(state: ComposerState, cursorOffset: number): { start: number; end: number } {
  const text = projectDocText(state.doc);
  const query = getMentionQuery(text, cursorOffset);
  return {
    start: query ? query.start : cursorOffset,
    end: mentionTokenEnd(text, cursorOffset),
  };
}

export function applyMentionDirectorySelection(
  state: ComposerState,
  relativeDirectory: string,
  entry: MentionEntry,
  cursorOffset: number,
): ComposerState {
  return insertText(
    state,
    mentionDirectoryText(relativeDirectory, entry),
    mentionRange(state, cursorOffset),
  );
}

export function applyMentionFileSelection(
  state: ComposerState,
  relativePath: string,
  cursorOffset: number,
): ComposerState {
  const text = projectDocText(state.doc);
  const range = mentionRange(state, cursorOffset);
  const nodes: ComposerNode[] = [{ kind: "file", relativePath }];
  if (!/^\s/.test(text.slice(range.end))) nodes.push({ kind: "text", text: " " });
  return insertNodes(state, nodes, range);
}

export function mentionParentSelection(
  state: ComposerState,
  relativeDirectory: string,
  cursorOffset: number,
): ComposerState | null {
  const parent = parentMentionEntry(relativeDirectory);
  if (!parent) return null;
  return applyMentionDirectorySelection(state, relativeDirectory, parent, cursorOffset);
}
