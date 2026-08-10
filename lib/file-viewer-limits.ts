// ── File preview size limits — client-safe shape ──────────────────────────
//
// Mirrored from lib/config.ts#FILE_VIEWER_LIMITS so client components
// (SettingsModal) can import the per-kind ranges without dragging in the
// server-only `lib/config.ts` (which imports `fs` / `path` / `os` and
// fails webpack's "module not found: fs" check on the client bundle).
//
// `lib/config.ts` re-exports the same types/consts from here so server
// callers (the /api/files route) can keep importing everything from one
// place. Keep the two files in sync — if you add a new FileViewerKind,
// update both `FILE_VIEWER_KINDS` and the `FILE_VIEWER_LIMITS` map.
//
// This split mirrors the project's "client-safe types in *-types.ts"
// convention (e.g. lib/show-file-tool-types.ts alongside
// lib/show-file-tool.ts).

export type FileViewerKind = "text" | "image" | "pdf";

export type FileViewerMaxSizeMb = Record<FileViewerKind, number>;

export interface FileViewerConfig {
  max_size_mb: FileViewerMaxSizeMb;
}

export const FILE_VIEWER_LIMITS: Record<FileViewerKind, { min: number; max: number }> = {
  text: { min: 1, max: 100 },
  image: { min: 1, max: 100 },
  pdf: { min: 1, max: 500 },
};

export const FILE_VIEWER_KINDS: readonly FileViewerKind[] = ["text", "image", "pdf"] as const;

export const FILE_VIEWER_DEFAULT_MAX_SIZE_MB: FileViewerMaxSizeMb = {
  text: 10,
  image: 10,
  pdf: 50,
};
