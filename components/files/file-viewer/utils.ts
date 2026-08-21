import { getFileName } from "@/lib/shared/file-paths";

export interface FileViewerProps {
	filePath: string;
	/** Only used to locate the git repo for gutter marks. */
	cwd?: string;
}

/**
 * Extension sets used by the top-level FileViewer dispatcher to pick
 * the right specialized viewer (image / audio / video / PDF). Anything
 * not matched here falls through to MonacoViewer.
 */
export const IMAGE_EXTS = new Set([
	"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
]);
export const AUDIO_EXTS = new Set([
	"mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba",
]);
export const VIDEO_EXTS = new Set([
	"mp4", "m4v", "mov", "webm", "ogv", "mkv",
]);
export const PDF_EXTS = new Set(["pdf"]);

export function isImagePath(filePath: string): boolean {
	const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";
	return IMAGE_EXTS.has(ext);
}

export function isAudioPath(filePath: string): boolean {
	const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";
	return AUDIO_EXTS.has(ext);
}

export function isVideoPath(filePath: string): boolean {
	const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";
	return VIDEO_EXTS.has(ext);
}

export function isPdfPath(filePath: string): boolean {
	const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";
	return PDF_EXTS.has(ext);
}

/** Human-readable file size. Used in the viewer toolbar. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** mm:ss formatter for audio/video duration display. */
export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds)) return "";
	const totalSeconds = Math.round(seconds);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return `${mins}:${String(secs).padStart(2, "0")}`;
}