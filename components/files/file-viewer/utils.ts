import type React from "react";
import { getFileName } from "@/lib/shared/file-paths";

export interface FileViewerProps {
	filePath: string;
	cwd?: string;
	rightPanelState?: "closed" | "normal" | "expanded";
	initialEditMode?: boolean;
}

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
export const MARKDOWN_EXTS = new Set(["md", "markdown", "mdx"]);

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

export function isMarkdownPath(filePath: string): boolean {
	const name = getFileName(filePath).toLowerCase();
	const dot = name.lastIndexOf(".");
	if (dot === -1) return false;
	return MARKDOWN_EXTS.has(name.slice(dot + 1));
}

export function toggleBtnStyle(active: boolean): React.CSSProperties {
	return {
		padding: "2px 8px",
		fontSize: 11,
		border: "none",
		cursor: "pointer",
		background: active ? "var(--bg-selected)" : "var(--bg-hover)",
		color: active ? "var(--text)" : "var(--text-muted)",
		fontWeight: active ? 600 : 400,
	};
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds)) return "";
	const totalSeconds = Math.round(seconds);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return `${mins}:${String(secs).padStart(2, "0")}`;
}