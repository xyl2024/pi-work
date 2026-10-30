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
