// Shared types + pure path helpers for the Notes feature.
// Pure functions only — this module must not import fs/path/node APIs or lib/server.

export type NoteNodeType = "folder" | "file";

export interface NoteNode {
  name: string;
  type: NoteNodeType;
  /** "/"-separated path relative to the user-notes root ("" for the root). */
  path: string;
  /** Folders only: sorted children (folders first, then files; each lexicographic). */
  children?: NoteNode[];
  /** Files only: byte size. */
  size?: number;
  /** Files only: ISO last-modified string. */
  mtime?: string;
}

/** Normalize a relative note path: strip leading/trailing slashes, collapse dups, reject "..". */
export function normalizeNotePath(p: string): string {
  return p
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
}

/** Directory (relative) holding a note's attachments.
 *  A note `foo.md` (or `dir/foo.md`) keeps its images in a sibling
 *  `<stem>.assets/` folder so the file + attachments move/rename/delete as one unit. */
export function noteAssetsDir(relNotePath: string): string {
  const parts = relNotePath.split("/").filter(Boolean);
  const base = parts.pop() ?? "";
  const stem = base.replace(/\.md$/i, "");
  parts.push(`${stem}.assets`);
  return parts.join("/");
}

/** Public URL for a note-relative attachment (images served via /api/notes-file). */
export function noteMediaUrl(relPath: string): string {
  return `/api/notes-file?p=${encodeURIComponent(relPath)}`;
}

/** True when a directory name is an internal attachment bundle that the
 *  notes list should hide. */
export function isNoteAssetsDir(name: string): boolean {
  return /\.assets$/i.test(name);
}