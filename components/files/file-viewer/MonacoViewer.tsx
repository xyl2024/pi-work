"use client";

// Right-side text file viewer built on Monaco.
//
// Previously this panel was split across TextViewer (Prism + react-markdown),
// DiffView (self-implemented Myers diff), VirtualizedCodeLines (large-file
// windowing) and FileSearchBar (custom inline search). All four are gone
// in favour of Monaco's editor + diff editor + built-in Ctrl-F find.
//
// Behaviour summary (see the design notes for full context):
//   • Read-only by default; "Edit" toggle enables editing. State is
//     per-component (not persisted across page reloads).
//   • Source / Diff vs HEAD toggle. Diff uses Monaco's DiffEditor and
//     fetches `git show HEAD:<path>` via /api/git/file-content.
//   • Save = PUT /api/files/<path>?type=write with JSON { content }.
//     10 MiB cap (server), 5 MiB warn / 50 MiB degrade thresholds
//     mirror it client-side. No confirmation dialog — see
//     lib/server/files/mutations.ts for the server-side check.
//   • Git gutter marks (added / modified lines) use
//     `editor.deltaDecorations`; deleted blocks render as inline
//     widgets (collapsed markers, click to expand) — same pattern as
//     the old Prism version, just driven by Monaco's API.
//   • Last-writer-wins: no watch, no conflict resolution. Switching
//     files / closing the panel silently discards dirty edits (the
//     tab title shows ● while dirty so users know).
//   • All keyboard shortcuts are wired through `editor.addCommand`
//     so Monaco consumes them before they bubble to the browser:
//     Ctrl/Cmd+S = save, Ctrl/Cmd+E = toggle Edit, Alt+Z = wrap.
//
// CodeBlock in chat messages is unaffected — it still uses Prism
// (see components/renderers/CodeBlock.tsx).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useMonacoLoader } from "@/hooks/useMonacoLoader";
import { encodeFilePathForApi, getFileName } from "@/lib/shared/file-paths";
import { parseFileDiff } from "@/lib/shared/git-line-marks";
import { getFileLanguage } from "@/lib/shared/monaco-language-map";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatSize, type FileViewerProps } from "./utils";

// Client-side thresholds. Mirrors FILE_PUT_MAX_BYTES on the server
// (10 MiB). Anything above the degrade threshold is forced read-only
// with no syntax highlighting; anything in the warn range shows a
// one-shot toast per file (no persistence, per the design).
const FILE_SIZE_WARN_BYTES = 5 * 1024 * 1024;
const FILE_SIZE_DEGRADE_BYTES = 50 * 1024 * 1024;

interface FileContent {
	content: string;
	language: string;
	size: number;
	mtime?: string | null;
}

interface DiffContent {
	original: string | null;
	exists: boolean;
	truncated: boolean;
	repoRoot: string | null;
	ref: string;
}

type ViewMode = "source" | "diff";
type SaveState = "idle" | "saving" | "saved" | "error";

export function MonacoViewer({ filePath, cwd }: FileViewerProps) {
	const { isDark } = useTheme();
	const { t } = useI18n();
	const fileName = getFileName(filePath);
	const langInfo = useMemo(() => getFileLanguage(filePath), [filePath]);

	const { monaco, loading: monacoLoading, error: monacoError, retry: retryMonaco } =
		useMonacoLoader();

	// ── File content state ────────────────────────────────────────────────
	const [content, setContent] = useState<string | null>(null);
	const [size, setSize] = useState<number>(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);

	// ── View state ────────────────────────────────────────────────────────
	const [editMode, setEditMode] = useState(false);
	const [viewMode, setViewMode] = useState<ViewMode>("source");
	const [wrapLines, setWrapLines] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
	const [lineCount, setLineCount] = useState<number>(0);

	// ── Git state ─────────────────────────────────────────────────────────
	const [gitHasChanges, setGitHasChanges] = useState(false);
	const [gitMarks, setGitMarks] = useState<Map<number, "added" | "modified"> | null>(null);
	const [deletedBlocks, setDeletedBlocks] = useState<
		Array<{ beforeLine: number; lines: string[] }>
	>([]);

	// ── Diff view state ───────────────────────────────────────────────────
	const [diffContent, setDiffContent] = useState<DiffContent | null>(null);
	const [diffLoading, setDiffLoading] = useState(false);
	const [diffError, setDiffError] = useState<string | null>(null);

	// ── Large-file state ──────────────────────────────────────────────────
	const [largeWarned, setLargeWarned] = useState(false);
	const [degraded, setDegraded] = useState(false);

	// ── Refs ──────────────────────────────────────────────────────────────
	const containerRef = useRef<HTMLDivElement | null>(null);
	const sourceEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
	const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
	const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
	const originalModelRef = useRef<Monaco.editor.ITextModel | null>(null);
	const decorationIdsRef = useRef<string[]>([]);
	const baselineRef = useRef<string | null>(null);
	const recentlySavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ── Reset all per-file state when the path changes ───────────────────
	useEffect(() => {
		// Tear down Monaco state from the previous file BEFORE React
		// schedules anything else — otherwise the editor-creation
		// effect below would briefly attach a new editor to the
		// old file's model.
		sourceEditorRef.current?.dispose();
		sourceEditorRef.current = null;
		diffEditorRef.current?.dispose();
		diffEditorRef.current = null;
		modelRef.current?.dispose();
		modelRef.current = null;
		originalModelRef.current?.dispose();
		originalModelRef.current = null;
		decorationIdsRef.current = [];
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
		setViewMode("source");
		setWrapLines(false);
		setDirty(false);
		setSaveState("idle");
		setSaveErrorMsg(null);
		setGitHasChanges(false);
		setGitMarks(null);
		setDeletedBlocks([]);

		setDiffContent(null);
		setDiffError(null);
		setDiffLoading(false);
		setLargeWarned(false);
		setDegraded(false);
		setReloadKey((k) => k + 1);
	}, [filePath]);

	// ── Fetch file content ───────────────────────────────────────────────
	useEffect(() => {
		if (loading === false && error === null && content !== null) return; // already loaded
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
					setEditMode(false); // force read-only
				} else if (d.size > FILE_SIZE_WARN_BYTES && !largeWarned) {
					setLargeWarned(true);
				}
			})
			.catch((e: unknown) => {
				setError(e instanceof Error ? e.message : String(e));
				setLoading(false);
			});
		// We deliberately don't include `loading`/`error`/`content` in deps
		// — the filePath-driven reset effect above already clears them.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filePath, reloadKey]);

	// ── Fetch git status + diff metadata ─────────────────────────────────
	useEffect(() => {
		if (!cwd || !content) return;
		const url = `/api/git/diff?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(filePath)}&base=head`;
		fetch(url)
			.then((r) => (r.ok ? r.json() : null))
			.then((d: { diff: string | null; truncated: boolean } | null) => {
				if (!d || d.truncated || !d.diff) {
					setGitHasChanges(false);
					setGitMarks(null);
					setDeletedBlocks([]);
					return;
				}
				const parsed = parseFileDiff(d.diff);
				const hasAny =
					parsed.lineMarks.size > 0 || parsed.deletedBlocks.length > 0;
				setGitHasChanges(hasAny);
				setGitMarks(parsed.lineMarks);
				setDeletedBlocks(parsed.deletedBlocks);
			})
			.catch(() => {
				// Silent — Diff button just stays hidden.
				setGitHasChanges(false);
				setGitMarks(null);
				setDeletedBlocks([]);
			});
	}, [cwd, filePath, content]);

	// ── Fetch HEAD content when entering diff view ───────────────────────
	useEffect(() => {
		if (viewMode !== "diff" || !cwd) return;
		if (diffContent !== null) return; // already loaded this path
		setDiffLoading(true);
		setDiffError(null);
		const url = `/api/git/file-content?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(filePath)}&ref=HEAD`;
		fetch(url)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((d: { content: string | null; exists: boolean; truncated: boolean; repoRoot: string | null; ref: string }) => {
				setDiffContent({
					original: d.content,
					exists: d.exists,
					truncated: d.truncated,
					repoRoot: d.repoRoot,
					ref: d.ref,
				});
				setDiffLoading(false);
			})
			.catch((e: unknown) => {
				setDiffError(e instanceof Error ? e.message : String(e));
				setDiffLoading(false);
			});
	}, [viewMode, cwd, filePath, diffContent]);

	// ── Editor instance lifecycle ────────────────────────────────────────
// We keep ONE working model across mode switches so unsaved edits
// survive source↔diff toggling. Switching modes tears down the
// editor (Monaco's editor.dispose() does NOT dispose the model)
// and the new editor takes ownership via setModel().
//
// IMPORTANT: model creation and editor creation are intentionally
// fused into a single effect. Splitting them would leave the editor
// effect with no React signal that the model is ready (refs don't
// trigger re-renders), so opening a second file would render blank.
useEffect(() => {
	if (!monaco || !containerRef.current) return;

	// Tear down everything from the previous file/mode first.
	sourceEditorRef.current?.dispose();
	sourceEditorRef.current = null;
	diffEditorRef.current?.dispose();
	diffEditorRef.current = null;
	if (modelRef.current) modelRef.current.dispose();
	modelRef.current = null;
	if (originalModelRef.current) originalModelRef.current.dispose();
	originalModelRef.current = null;
	decorationIdsRef.current = [];

	// Wait for the file fetch to land before creating a model.
	if (content === null) return;

	const wantsDiff = viewMode === "diff";
	if (wantsDiff && !diffContent) return;

	const lang = langInfo.id === "text" ? "plaintext" : langInfo.id;
	const uri = monaco.Uri.parse(
		`file://${encodeURIComponent(filePath)}?v=${Date.now()}`,
	);
	modelRef.current = monaco.editor.createModel(content, lang, uri);
	baselineRef.current = content;
	setDirty(false);

	const container = containerRef.current;
	if (!wantsDiff) {
		const editor = monaco.editor.create(container, {
			theme: isDark ? "vs-dark" : "vs",
			readOnly: !editMode || degraded,
			minimap: { enabled: !degraded, scale: 1 },
			wordWrap: wrapLines ? "on" : "off",
			fontSize: 13,
			fontFamily: "var(--font-mono)",
			lineNumbers: "on",
			scrollBeyondLastLine: false,
			automaticLayout: true,
			renderWhitespace: "none",
			tabSize: 4,
			// Avoid context menus interfering with our own shortcuts
			contextmenu: false,
		});
		sourceEditorRef.current = editor;
		editor.setModel(modelRef.current);
		applyDecorations(editor, monaco);
		bindEditorEvents(editor);
	} else {
		const originalUri = monaco.Uri.parse(
			`file-head://${encodeURIComponent(filePath)}`,
		);
		originalModelRef.current = monaco.editor.createModel(
			diffContent?.original ?? "",
			lang,
			originalUri,
		);
		const diffEditor = monaco.editor.createDiffEditor(container, {
			theme: isDark ? "vs-dark" : "vs",
			readOnly: true,
			renderSideBySide: true,
			minimap: { enabled: false },
			fontSize: 13,
			fontFamily: "var(--font-mono)",
			lineNumbers: "on",
			automaticLayout: true,
			originalEditable: false,
			ignoreTrimWhitespace: false,
		});
		diffEditor.setModel({
			original: originalModelRef.current,
			modified: modelRef.current,
		});
		diffEditorRef.current = diffEditor;
	}
	// applyDecorations / bindEditorEvents are defined later in the
	// component body as plain functions; listing them in deps would
	// re-run this effect on every render without changing inputs.
	// eslint-disable-next-line react-hooks/exhaustive-deps
}, [
	monaco,
	filePath,
	langInfo.id,
	content,
	viewMode,
	diffContent,
	editMode,
	isDark,
	wrapLines,
	degraded,
]);

// ── Update editor options in-place when they change ────────────────
// Avoids tearing down and rebuilding the editor every time the user
// toggles Wrap or Edit mode (which would lose scroll position,
// selection, and undo stack).
useEffect(() => {
	if (!sourceEditorRef.current) return;
	sourceEditorRef.current.updateOptions({
		theme: isDark ? "vs-dark" : "vs",
		readOnly: !editMode || degraded,
		minimap: { enabled: !degraded, scale: 1 },
		wordWrap: wrapLines ? "on" : "off",
	});
}, [editMode, isDark, wrapLines, degraded]);

	// ── Refresh decorations whenever the git data updates ─────────────
	// The editor-creation effect calls applyDecorations once; this one
	// re-applies them when git marks arrive async after file load.
	useEffect(() => {
		if (!monaco || !sourceEditorRef.current) return;
		applyDecorations(sourceEditorRef.current, monaco);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [monaco, gitMarks, deletedBlocks]);

	// ── Tear down on unmount ─────────────────────────────────────────────
	useEffect(() => {
		return () => {
			sourceEditorRef.current?.dispose();
			diffEditorRef.current?.dispose();
			modelRef.current?.dispose();
			originalModelRef.current?.dispose();
			if (recentlySavedTimerRef.current) {
				clearTimeout(recentlySavedTimerRef.current);
			}
		};
	}, []);

	// ── Apply / refresh git decorations ──────────────────────────────────
	function applyDecorations(editor: Monaco.editor.IStandaloneCodeEditor, monacoNs: typeof import("monaco-editor")) {
		const newDecorations: Monaco.editor.IModelDeltaDecoration[] = [];

		// Per-line marks (added / modified). Whole-line border-left via
		// the CSS rules in app/globals.css; overview-ruler bars give
		// the user the scroll-bar hint even when scrolled away.
		if (gitMarks) {
			for (const [lineNo, type] of gitMarks) {
				const isAdded = type === "added";
				newDecorations.push({
					range: new monacoNs.Range(lineNo, 1, lineNo, 1),
					options: {
						isWholeLine: true,
						className: isAdded
							? "pi-git-line-added"
							: "pi-git-line-modified",
						overviewRuler: {
							color: isAdded ? "#4ade80" : "#60a5fa",
							position: monacoNs.editor.OverviewRulerLane.Full,
						},
					},
				});
			}
		}

		// Deleted-block pills in the glyph margin. Monaco positions
		// each glyph margin decoration at the line in its range, so
		// the "−N" pills line up with where the missing lines belonged
		// without us having to measure the editor ourselves. The full
		// deleted text surfaces in the hover message.
		for (const block of deletedBlocks) {
			newDecorations.push({
				range: new monacoNs.Range(
					block.beforeLine,
					1,
					block.beforeLine,
					1,
				),
				options: {
					glyphMarginClassName: "pi-git-deleted-marker",
					glyphMarginHoverMessage: {
						value:
							block.lines.length === 0
								? "(empty)"
								: block.lines
										.map((l) => `- ${l}`)
										.join("\n"),
					},
				},
			});
		}

		decorationIdsRef.current = editor.deltaDecorations(
			decorationIdsRef.current,
			newDecorations,
		);
	}

	// ── Wire Monaco editor events (keybindings, dirty tracking) ──────────
	function bindEditorEvents(editor: Monaco.editor.IStandaloneCodeEditor) {
		if (!monaco) return;
		// Ctrl/Cmd+S → save
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			if (!editMode) return;
			void save();
		});
		// Ctrl/Cmd+E → toggle edit mode
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, () => {
			if (degraded) return;
			setEditMode((v) => !v);
		});
		// Alt+Z → toggle word wrap
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

	// ── Save flow ────────────────────────────────────────────────────────
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
			// Update baseline so the dirty check returns false. We do
			// NOT call setContent() — that would trigger the editor-
			// creation effect above and dispose the user's editor.
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

	// ── Render: monaco-loading state ─────────────────────────────────────
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

	// ── Render: main viewer ──────────────────────────────────────────────
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
			{/* Toolbar */}
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

				{/* Source / Diff toggle — only when file is modified relative to HEAD */}
				{gitHasChanges && (
					<div
						style={{
							display: "flex",
							borderRadius: 5,
							overflow: "hidden",
							border: "1px solid var(--border)",
						}}
					>
						<button
							onClick={() => setViewMode("source")}
							style={toggleBtnStyle(viewMode === "source")}
						>
							{t("Source")}
						</button>
						<button
							onClick={() => setViewMode("diff")}
							style={toggleBtnStyle(viewMode === "diff")}
						>
							{t("Diff vs HEAD")}
						</button>
					</div>
				)}

				{/* Edit toggle */}
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

				{/* Save button — visible when dirty or saving or error */}
				{showSave && editMode && (
					<SaveButton
						state={saveState}
						error={saveErrorMsg}
						onClick={save}
					/>
				)}

				{/* Wrap toggle */}
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

			{/* Diff error banner (overlay) */}
			{viewMode === "diff" && (diffError || diffLoading) && (
				<div
					style={{
						padding: "12px 16px",
						background: "#3d2020",
						color: "#f87171",
						fontSize: 12,
						borderBottom: "1px solid var(--border)",
						display: "flex",
						alignItems: "center",
						gap: 12,
					}}
				>
					<span>
						{diffLoading
							? t("Loading editor...")
							: `${t("Cannot load HEAD version")}: ${diffError}`}
					</span>
					{diffError && (
						<button
							onClick={() => {
								setDiffContent(null);
								setDiffError(null);
							}}
							style={toggleBtnStyle(false)}
						>
							{t("Retry")}
						</button>
					)}
					<button
						onClick={() => setViewMode("source")}
						style={toggleBtnStyle(false)}
					>
						{t("Close diff view")}
					</button>
				</div>
			)}

			{/* Editor container — Monaco mounts here */}
			<div
				ref={containerRef}
				key={`${filePath}-${viewMode}`}
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

// Deleted blocks now render via Monaco glyph-margin decorations
// (see `applyDecorations` above) and surface their content in the
// hover message. We deliberately don't try to position a click-popup
// ourselves — Monaco's positioning API for that is awkward, and the
// hover message already shows the full deleted text.