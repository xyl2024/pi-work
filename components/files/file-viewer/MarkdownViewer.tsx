"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/hooks/useI18n";
import { encodeFilePathForApi, getFileName } from "@/lib/shared/file-paths";
import { useMarkdownComponents } from "@/components/chat/message-view/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import { MonacoViewer, type MonacoViewerHandle } from "./MonacoViewer";
import { formatSize, toggleBtnStyle, type FileViewerProps } from "./utils";

const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

interface FileContent {
	content: string;
	size: number;
	mtime?: string | null;
}

type ViewerMode = "preview" | "edit";

export function MarkdownViewer({
	filePath,
	rightPanelState = "normal",
}: FileViewerProps) {
	const { t } = useI18n();
	const fileName = getFileName(filePath);

	const [content, setContent] = useState<string | null>(null);
	const [size, setSize] = useState<number>(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [mode, setMode] = useState<ViewerMode>("preview");

	const editorRef = useRef<MonacoViewerHandle | null>(null);

	useEffect(() => {
		setLoading(true);
		setError(null);
		setMode("preview");
		const encoded = encodeFilePathForApi(filePath);
		fetch(`/api/files/${encoded}?type=read`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((d: FileContent & { error?: string }) => {
				if (d.error) throw new Error(d.error);
				setContent(d.content);
				setSize(d.size);
				setLoading(false);
				if (d.size > PREVIEW_MAX_BYTES) setMode("edit");
			})
			.catch((e: unknown) => {
				setError(e instanceof Error ? e.message : String(e));
				setLoading(false);
			});
	}, [filePath, reloadKey]);

	const backToPreview = useCallback(async () => {
		const saved = await editorRef.current?.save();
		if (saved === false) return;
		setMode("preview");
		setReloadKey((k) => k + 1);
	}, []);
	const handlePreviewClick = useCallback(() => {
		if (mode === "edit") {
			void backToPreview();
			return;
		}
		setMode("preview");
	}, [backToPreview, mode]);

	const markdownComponents = useMarkdownComponents();

	const previewAvailable = size <= PREVIEW_MAX_BYTES || size === 0;

	if (loading && content === null) {
		return (
			<div
				style={{
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: "var(--text-muted)",
					fontSize: 13,
				}}
			>
				{t("Loading...")}
			</div>
		);
	}

	if (error && content === null) {
		return (
			<div
				style={{
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: "#f87171",
					fontSize: 13,
				}}
			>
				{error}
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 12,
					padding: "4px 16px",
					borderBottom: "1px solid var(--border)",
					fontSize: 11,
					color: "var(--text-dim)",
					background: "var(--bg)",
					flexShrink: 0,
				}}
			>
				<span style={{ fontWeight: 600 }}>{fileName}</span>
				<span
					style={{
						padding: "1px 6px",
						background: "var(--bg-panel)",
						borderRadius: 3,
						fontSize: 10,
					}}
				>
					{t("Markdown")}
				</span>
				<span>{formatSize(size)}</span>

				{previewAvailable ? (
					<button
						onClick={handlePreviewClick}
						style={toggleBtnStyle(mode === "preview")}
					>
						{t("Preview")}
					</button>
				) : (
					<Tooltip content={t("File is too large to preview")}>
						<button
							disabled
							style={{
								...toggleBtnStyle(mode === "preview"),
								cursor: "not-allowed",
								opacity: 0.6,
							}}
						>
							{t("Preview")}
						</button>
					</Tooltip>
				)}
				<button
					onClick={() => setMode("edit")}
					style={toggleBtnStyle(mode === "edit")}
				>
					{t("Edit")}
				</button>
			</div>

			{mode === "preview" ? (
				<div
					style={{
						flex: 1,
						overflowY: "auto",
						background: "var(--bg)",
					}}
				>
					<div
						className="markdown-body"
						style={{
							padding: "12px 16px",
							fontSize: 13,
							maxWidth: 720,
							margin: "0 auto",
						}}
					>
						<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
							{content ?? ""}
						</ReactMarkdown>
					</div>
				</div>
			) : (
				<div style={{ flex: 1, overflow: "hidden" }}>
					<MonacoViewer
						key={filePath}
						ref={editorRef}
						filePath={filePath}
						rightPanelState={rightPanelState}
						initialEditMode
					/>
				</div>
			)}
		</div>
	);
}
