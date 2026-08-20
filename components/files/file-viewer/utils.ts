import { getFileName, normalizeFilePathSlashes } from "@/lib/shared/file-paths";

export interface FileViewerProps {
  filePath: string;
  /** Only used to locate the git repo for gutter marks. */
  cwd?: string;
}

export interface FileData {
  content: string;
  language: string;
  size: number;
}

export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
export const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba"]);
export const VIDEO_EXTS = new Set(["mp4", "m4v", "mov", "webm", "ogv", "mkv"]);
export const PDF_EXTS = new Set(["pdf"]);

export const GIT_ADDED_COLOR = "#4ade80";
export const GIT_MODIFIED_COLOR = "#60a5fa";
export const GIT_DELETED_COLOR = "#f87171";
export const CODE_LINE_HEIGHT = 13 * 1.6;
export const CODE_TOP_PADDING = 12;
export const VIRTUALIZE_MIN_LINES = 2000;
export const VIRTUALIZE_MIN_BYTES = 500 * 1024;

export function isImagePath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXTS.has(ext);
}

export function isAudioPath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return AUDIO_EXTS.has(ext);
}

export function isVideoPath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return VIDEO_EXTS.has(ext);
}

export function isPdfPath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return PDF_EXTS.has(ext);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Resolve a markdown image src against the markdown file's directory.
// Pure string ops — keeps the Node `path` module out of the client bundle.
export function resolveRelativePath(src: string, mdFilePath: string): string {
  const normalized = normalizeFilePathSlashes(mdFilePath);
  // Already absolute (POSIX, Windows drive, or UNC) — use as-is
  if (src.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(src) || src.startsWith("\\\\")) {
    return normalizeFilePathSlashes(src);
  }
  const isWindowsPath = /^[a-zA-Z]:/.test(normalized);
  const dir = normalized.replace(/[^/]+$/, ""); // strip filename
  const parts = (dir + src).split("/").filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  }
  if (isWindowsPath && out[0]) {
    return out.length > 1 ? `${out[0]}/${out.slice(1).join("/")}` : out[0];
  }
  return "/" + out.join("/");
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
