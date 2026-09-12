"use client";

import { useCallback, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/components/ui/Toast";
import { IconButton } from "@/components/ui/IconButton";
import { uploadNoteImage } from "@/lib/client/notes";

interface NotesEditorProps {
  noteRel: string;
  value: string;
  onChange: (next: string) => void;
  /** Triggered on Cmd/Ctrl+S for an immediate save. */
  onSave?: () => void;
}

/** Wrap/unwrap the selection (or a placeholder) with before/after markers.
 *  If the selection is already wrapped, the markers are removed instead. */
function toggleWrap(view: EditorView, before: string, after: string, placeholder?: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length);
    view.dispatch({
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length },
    });
  } else {
    const text = selected || placeholder || "";
    view.dispatch({
      changes: { from, to, insert: `${before}${text}${after}` },
      selection: { anchor: from + before.length, head: from + before.length + text.length },
    });
  }
  view.focus();
}

/** Add or remove a line prefix (quote / list markers) on every selected line. */
function toggleLinePrefix(view: EditorView, prefix: string) {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from).number;
  const endLine = view.state.doc.lineAt(to).number;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = startLine; n <= endLine; n++) {
    const line = view.state.doc.line(n);
    if (line.text.startsWith(prefix)) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    } else if (line.text.length > 0) {
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }
  if (changes.length > 0) view.dispatch({ changes });
  view.focus();
}

/** Cycle the heading level of the selection's first line: none → # → ## → ### → none. */
function cycleHeading(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  const match = /^(#{1,3})( )/.exec(line.text);
  const next = !match ? "# " : match[1].length < 3 ? `${"#".repeat(match[1].length + 1)} ` : "";
  view.dispatch({
    changes: { from: line.from, to: line.from + (match ? match[0].length : 0), insert: next },
  });
  view.focus();
}

/** Insert a multi-line block at the cursor (code fence, table, …). */
function insertBlock(view: EditorView, block: string) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const prefix = line.text.length === 0 ? "" : "\n";
  view.dispatch({
    changes: { from: line.from, to: line.from, insert: `${prefix}${block}\n` },
    selection: { anchor: line.from + prefix.length + block.length + 1 },
  });
  view.focus();
}

const TABLE_SNIPPET = "| Column | Column |\n| --- | --- |\n|  |  |";

/** Run a markdown wrap/insert on an editor view. Dispatches a change (which
 *  @uiw/react-codemirror reports back through onChange automatically). */
function runInsert(view: EditorView, before: string, after: string, placeholder?: string) {
  toggleWrap(view, before, after, placeholder);
}

export function NotesEditor({ noteRel, value, onChange, onSave }: NotesEditorProps) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const toast = useToast();
  const viewRef = useRef<EditorView | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onCreateEditor = useCallback((view: EditorView) => {
    viewRef.current = view;
  }, []);

  // Upload picked/dropped/pasted image files, then insert their references.
  const handleFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      const view = viewRef.current;
      for (const file of Array.from(files)) {
        try {
          const { url } = await uploadNoteImage(noteRel, file);
          const alt = file.name.replace(/\.(png|jpe?g|gif|webp|svg|avif)$/i, "");
          if (view) runInsert(view, `![${alt}](${url})\n`, "");
        } catch (err) {
          toast.show({ kind: "error", message: t("Image upload failed"), description: err instanceof Error ? err.message : String(err) });
        }
      }
    },
    [noteRel, t, toast],
  );

  const withView = useCallback((fn: (view: EditorView) => void) => {
    const view = viewRef.current;
    if (view) fn(view);
  }, []);

  // Markdown keyboard shortcuts (Cmd/Ctrl+B, I, K, Mod-E code block, Mod-Shift-K task list).
  const bindings = [
    { key: "Mod-b", run: (view: EditorView) => (toggleWrap(view, "**", "**", "bold"), true) },
    { key: "Mod-i", run: (view: EditorView) => (toggleWrap(view, "*", "*", "italic"), true) },
    { key: "Mod-k", run: (view: EditorView) => (toggleWrap(view, "[", "](url)", "text"), true) },
    { key: "Mod-e", run: (view: EditorView) => (insertBlock(view, "```\n\n```"), true) },
    { key: "Mod-Shift-k", run: (view: EditorView) => (toggleLinePrefix(view, "- [ ] "), true) },
    { key: "Mod-s", run: () => { onSave?.(); return true; } },
  ];
  const extensions = [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    keymap.of(bindings),
  ];

  const toolbarGroups: React.ReactNode[][] = [
    [
      <IconButton key="h" label={t("Heading")} size="xs" onClick={() => withView(cycleHeading)}>
        <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1 }}>H</span>
      </IconButton>,
      <IconButton key="b" label={`${t("Bold")} (Ctrl+B)`} size="xs" onClick={() => withView((v) => toggleWrap(v, "**", "**", "bold"))}>
        <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>B</span>
      </IconButton>,
      <IconButton key="i" label={`${t("Italic")} (Ctrl+I)`} size="xs" onClick={() => withView((v) => toggleWrap(v, "*", "*", "italic"))}>
        <span style={{ fontSize: 12, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1 }}>I</span>
      </IconButton>,
      <IconButton key="code" label={t("Code")} size="xs" onClick={() => withView((v) => toggleWrap(v, "`", "`", "code"))}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
      </IconButton>,
    ],
    [
      <IconButton key="ul" label={t("Unordered list")} size="xs" onClick={() => withView((v) => toggleLinePrefix(v, "- "))}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="0.5" /><circle cx="3.5" cy="12" r="0.5" /><circle cx="3.5" cy="18" r="0.5" /></svg>
      </IconButton>,
      <IconButton key="ol" label={t("Ordered list")} size="xs" onClick={() => withView((v) => toggleLinePrefix(v, "1. "))}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 6h11M10 12h11M10 18h11" /><path d="M4 6h1v4" /><path d="M4 14h2a1 1 0 0 1 0 2H5a1 1 0 0 0 0 2h2" /></svg>
      </IconButton>,
      <IconButton key="task" label={t("Task list")} size="xs" onClick={() => withView((v) => toggleLinePrefix(v, "- [ ] "))}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="6" height="6" rx="1" /><path d="M13 8h8" /><rect x="3" y="14" width="6" height="6" rx="1" /><path d="M13 17h8" /></svg>
      </IconButton>,
      <IconButton key="quote" label={t("Quote")} size="xs" onClick={() => withView((v) => toggleLinePrefix(v, "> "))}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h18" /><path d="M4 9h13" /><path d="M4 14h16" /><path d="M4 19h10" /></svg>
      </IconButton>,
    ],
    [
      <IconButton key="link" label={`${t("Link")} (Ctrl+K)`} size="xs" onClick={() => withView((v) => toggleWrap(v, "[", "](url)", "text"))}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
      </IconButton>,
      <IconButton key="fence" label={`${t("Code block")} (Ctrl+E)`} size="xs" onClick={() => withView((v) => insertBlock(v, "```\n\n```"))}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m9 10-2 2 2 2" /><path d="m15 10 2 2-2 2" /></svg>
      </IconButton>,
      <IconButton key="table" label={t("Table")} size="xs" onClick={() => withView((v) => insertBlock(v, TABLE_SNIPPET))}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M9 4v16" /><path d="M15 4v16" /></svg>
      </IconButton>,
      <IconButton key="img" label={t("Insert image")} size="xs" onClick={() => fileInputRef.current?.click()}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-4.5-4.5L7 20" /></svg>
      </IconButton>,
    ],
  ];

  return (
    <div
      data-editor-root
      className="cm-editor-scoped"
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
      onPaste={(e) => {
        const files = e.clipboardData?.files;
        if (files && files.length > 0) {
          e.preventDefault();
          handleFiles(files);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer?.files ?? null);
      }}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Formatting toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "3px 8px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {toolbarGroups.map((group, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
            {i > 0 && <span style={{ width: 1, height: 14, background: "var(--border)", marginRight: 9 }} />}
            {group}
          </div>
        ))}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Editor body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <CodeMirror
          value={value}
          onChange={(v) => onChange(v)}
          onCreateEditor={onCreateEditor}
          extensions={extensions}
          theme={isDark ? "dark" : "light"}
          basicSetup={{ foldGutter: true, autocompletion: true, highlightActiveLine: true }}
          height="100%"
          style={{ height: "100%", fontSize: 13 }}
        />
      </div>
    </div>
  );
}
