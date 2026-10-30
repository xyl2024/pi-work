"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useMonacoLoader } from "@/hooks/useMonacoLoader";
import { PI_WORK_DARK_THEME_NAME } from "@/lib/client/monaco-theme";
import { encodeFilePathForApi, getFileName } from "@/lib/shared/file-paths";
import { getFileLanguage } from "@/lib/shared/monaco-language-map";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatSize, type FileViewerProps } from "./utils";

const FILE_SIZE_WARN_BYTES = 5 * 1024 * 1024;
const FILE_SIZE_DEGRADE_BYTES = 50 * 1024 * 1024;

interface FileContent {
	content: string;
	language: string;
	size: number;
	mtime?: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function MonacoViewer({
	filePath,
	rightPanelState = "normal",
}: FileViewerProps) {
	const { isDark } = useTheme();
	const { t } = useI18n();
	const fileName = getFileName(filePath);
	const langInfo = useMemo(() => getFileLanguage(filePath), [filePath]);

	const { monaco, loading: monacoLoading, error: monacoError, retry: retryMonaco } =
		useMonacoLoader();

	const [content, setContent] = useState<string | null>(null);
	const [size, setSize] = useState<number>(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);

	const [editMode, setEditMode] = useState(false);
	const [wrapLines, setWrapLines] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
	const [lineCount, setLineCount] = useState<number>(0);

	const [largeWarned, setLargeWarned] = useState(false);
	const [degraded, setDegraded] = useState(false);

	const minimapEnabled = rightPanelState === "expanded" && !degraded;

	const containerRef = useRef<HTMLDivElement | null>(null);
	const sourceEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
	const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
	const baselineRef = useRef<string | null>(null);
	const recentlySavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		sourceEditorRef.current?.dispose();
		sourceEditorRef.current = null;
		modelRef.current?.dispose();
		modelRef.current = null;
		if (recentlySavedTimerRef.current) {
			clearTimeout(recentlySavedTimerRef.current);
			recentlySavedTimerRef.current = null;
		}

		setLoading(true);
		setError(null);
		setContent(null);
		setSize(0);
		setLineCount(0);
		setEditMode(false);
		setWrapLines(false);
		setDirty(false);
		setSaveState("idle");
		setSaveErrorMsg(null);
		setLargeWarned(false);
		setDegraded(false);
		setReloadKey((k) => k + 1);
	}, [filePath]);

	useEffect(() => {
		if (loading === false && error === null && content !== null) return;
		const encoded = encodeFilePathForApi(filePath);
		setLoading(true);
		setError(null);
		fetch(`/api/files/${encoded}?type=read`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((d: FileContent & { error?: string }) => {
				if (d.error) throw new Error(d.error);
				setContent(d.content);
				setSize(d.size);
				setLoading(false);
				const lc = d.content.length === 0 ? 0 : d.content.split("\n").length;
				setLineCount(lc);
				if (d.size > FILE_SIZE_DEGRADE_BYTES) {
					setDegraded(true);
					setEditMode(false);
				} else if (d.size > FILE_SIZE_WARN_BYTES && !largeWarned) {
					setLargeWarned(true);
				}
			})
			.catch((e: unknown) => {
				setError(e instanceof Error ? e.message : String(e));
				setLoading(false);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filePath, reloadKey]);

	useEffect(() => {
	if (!monaco || !containerRef.current) return;

	sourceEditorRef.current?.dispose();
	sourceEditorRef.current = null;
	if (modelRef.current) modelRef.current.dispose();
	modelRef.current = null;

	if (content === null) return;

	const lang = langInfo.id === "text" ? "plaintext" : langInfo.id;
	const uri = monaco.Uri.parse(
		`file://${encodeURIComponent(filePath)}?v=${Date.now()}`,
	);
	modelRef.current = monaco.editor.createModel(content, lang, uri);
	baselineRef.current = content;
	setDirty(false);

	const container = containerRef.current;
	const editor = monaco.editor.create(container, {
			theme: isDark ? PI_WORK_DARK_THEME_NAME : "vs",
			readOnly: !editMode || degraded,
			minimap: { enabled: minimapEnabled, scale: 1 },
			wordWrap: wrapLines ? "on" : "off",
			fontSize: 13,
			fontFamily: "var(--font-mono-stack)",
			lineNumbers: "on",
			scrollBeyondLastLine: false,
			automaticLayout: true,
			renderWhitespace: "none",
			tabSize: 4,
			contextmenu: false,
	});
	sourceEditorRef.current = editor;
	editor.setModel(modelRef.current);
	bindEditorEvents(editor);
	// eslint-disable-next-line react-hooks/exhaustive-deps
}, [
	monaco,
	filePath,
	langInfo.id,
	content,
	editMode,
	isDark,
	wrapLines,
	degraded,
	minimapEnabled,
]);

useEffect(() => {
	if (!sourceEditorRef.current) return;
	sourceEditorRef.current.updateOptions({
		theme: isDark ? PI_WORK_DARK_THEME_NAME : "vs",
		readOnly: !editMode || degraded,
		minimap: { enabled: minimapEnabled, scale: 1 },
		wordWrap: wrapLines ? "on" : "off",
	});
}, [editMode, isDark, wrapLines, degraded, minimapEnabled]);

	useEffect(() => {
		return () => {
			sourceEditorRef.current?.dispose();
			modelRef.current?.dispose();
			if (recentlySavedTimerRef.current) {
				clearTimeout(recentlySavedTimerRef.current);
			}
		};
	}, []);

	function bindEditorEvents(editor: Monaco.editor.IStandaloneCodeEditor) {
		if (!monaco) return;
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			if (!editMode) return;
			void save();
		});
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, () => {
			if (degraded) return;
			setEditMode((v) => !v);
		});
		editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () => {
			setWrapLines((v) => !v);
		});

		editor.onDidChangeModelContent(() => {
			const current = editor.getValue();
			const isDirty = current !== (baselineRef.current ?? "");
			setDirty(isDirty);
			if (isDirty && saveState === "saved") setSaveState("idle");
		});
	}

	const save = useCallback(async () => {
		if (!monaco || !sourceEditorRef.current || !modelRef.current) return;
		const value = modelRef.current.getValue();
		setSaveState("saving");
		setSaveErrorMsg(null);
		try {
			const encoded = encodeFilePathForApi(filePath);
			const r = await fetch(`/api/files/${encoded}?type=write`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ content: value }),
			});
			if (!r.ok) {
				const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
				throw new Error(err.error || `HTTP ${r.status}`);
			}
			setSaveState("saved");
			baselineRef.current = value;
			setDirty(false);
			if (recentlySavedTimerRef.current) clearTimeout(recentlySavedTimerRef.current);
			recentlySavedTimerRef.current = setTimeout(() => {
				setSaveState("idle");
			}, 1500);
		} catch (e: unknown) {
			setSaveState("error");
			setSaveErrorMsg(e instanceof Error ? e.message : String(e));
		}
	}, [monaco, filePath]);

	if (monacoLoading || (loading && !content)) {
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
				{monacoLoading ? t("Loading editor...") : t("Loading...")}
			</div>
		);
	}

	if (monacoError) {
		return (
			<div
				style={{
					height: "100%",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					color: "#f87171",
					fontSize: 13,
					gap: 12,
					padding: 24,
					textAlign: "center",
				}}
			>
				<div>{t("Editor failed to load")}</div>
				<div style={{ color: "var(--text-muted)", fontSize: 11 }}>
					{monacoError.message}
				</div>
				<button
					onClick={retryMonaco}
					style={{
						padding: "4px 12px",
						background: "var(--bg-hover)",
						border: "1px solid var(--border)",
						borderRadius: 5,
						color: "var(--text)",
						cursor: "pointer",
						fontSize: 12,
					}}
				>
					{t("Retry")}
				</button>
			</div>
		);
	}

	if (error) {
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

	if (!content || !monaco) return null;

	const showSave = dirty || saveState !== "idle";

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
					{langInfo.label}
				</span>
				<span>{lineCount} {t("lines")}</span>
				<span>{formatSize(size)}</span>

				{dirty && (
					<Tooltip content={t("Unsaved changes")}>
						<span style={{ color: "#f87171", fontSize: 14 }}>●</span>
					</Tooltip>
				)}

				{!degraded && (
					<Tooltip content={`${t("Edit file")} (Ctrl+E)`}>
						<button
							onClick={() => setEditMode((v) => !v)}
							style={toggleBtnStyle(editMode)}
						>
							{editMode ? t("Editing") : t("Read-only")}
						</button>
					</Tooltip>
				)}

				{showSave && editMode && (
					<SaveButton
						state={saveState}
						error={saveErrorMsg}
						onClick={save}
					/>
				)}

				<Tooltip
					content={wrapLines ? t("Disable word wrap") : t("Enable word wrap")}
				>
					<button
						onClick={() => setWrapLines((v) => !v)}
						style={toggleBtnStyle(wrapLines)}
					>
						{t("wrap")}
					</button>
				</Tooltip>

				{degraded && (
					<span style={{ color: "#fbbf24", fontSize: 10 }}>
						{t("File opened read-only because it is very large")}
					</span>
				)}
			</div>

			<div
				ref={containerRef}
				key={filePath}
				style={{
					flex: 1,
					overflow: "hidden",
					background: "var(--bg)",
					position: "relative",
				}}
			/>
		</div>
	);
}

function toggleBtnStyle(active: boolean): React.CSSProperties {
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

function SaveButton({
	state,
	error,
	onClick,
}: {
	state: SaveState;
	error: string | null;
	onClick: () => void;
}) {
	const { t } = useI18n();
	const baseStyle: React.CSSProperties = {
		padding: "2px 10px",
		fontSize: 11,
		border: "1px solid var(--border)",
		borderRadius: 5,
		cursor: "pointer",
		display: "flex",
		alignItems: "center",
		gap: 4,
		fontWeight: 600,
	};
	if (state === "saving") {
		return (
			<button style={{ ...baseStyle, background: "var(--bg-hover)", color: "var(--text-muted)" }} disabled>
				<span
					style={{
						width: 8,
						height: 8,
						borderRadius: "50%",
						border: "1.5px solid var(--text-muted)",
						borderTopColor: "transparent",
						animation: "pi-spin 0.8s linear infinite",
					}}
				/>
				{t("Saving...")}
			</button>
		);
	}
	if (state === "saved") {
		return (
			<button style={{ ...baseStyle, background: "#16a34a", color: "white", borderColor: "#16a34a" }} disabled>
				<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
					<polyline points="5 12 10 17 19 8" />
				</svg>
				{t("Saved")}
			</button>
		);
	}
	if (state === "error") {
		return (
			<Tooltip content={error ?? t("Save failed")}>
				<button
					onClick={onClick}
					style={{ ...baseStyle, background: "#7f1d1d", color: "white", borderColor: "#7f1d1d" }}
				>
					{t("Save failed")}
				</button>
			</Tooltip>
		);
	}
	return (
		<button onClick={onClick} style={{ ...baseStyle, background: "var(--bg-selected)", color: "var(--text)" }}>
			{t("Save")} (Ctrl+S)
		</button>
		);
	}
