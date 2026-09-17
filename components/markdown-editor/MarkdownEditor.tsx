"use client";

import { useCallback, useMemo, useRef, type ReactNode } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView, keymap } from "@codemirror/view";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { IconButton } from "@/components/ui/IconButton";

/**
 * Markdown editing on CodeMirror: the notes panel's editor, shared.
 *
 * The plan detail dialog used to pair a rendered preview with a bare
 * `<textarea>`, so the same activity — writing a Markdown note — had two
 * different handwritings. This is the one surface both hosts now use: the
 * notes panel keeps it as-is, the plan dialog gets the same toolbar,
 * highlight and keymap without owning a second editor.
 *
 * The Markdown language support brings `markdownKeymap` along (`addKeymap`
 * defaults to true), so Enter continues a list / quote and Backspace removes
 * the markup it would otherwise leave behind; neither is written here.
 *
 * `onUploadImage` is the only capability that differs by host, and it is what
 * the notes panel adds: with a handler the toolbar grows 插入图片 and pasted /
 * dropped files are intercepted. Without one — the plan dialog, which has no
 * asset folder — there is no image button and the browser keeps its defaults.
 */
export interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Binds Cmd/Ctrl+S inside the editor. Omit when the host already handles
   *  that keystroke around the editor (the plan dialog handles it on its card,
   *  so the key must be left to bubble). */
  onSave?: () => void;
  /** Upload one image and return its URL; the editor inserts `![name](url)`.
   *  Return null for a failure the host has already reported. */
  onUploadImage?: (file: File) => Promise<string | null>;
  placeholder?: string;
  /** Accessible name for the editing surface. */
  ariaLabel?: string;
  /** Toolbar visibility. Defaults to true. */
  toolbar?: boolean;
  /** Editing surface font size. Defaults to the notes panel's 13. */
  fontSize?: number;
  /** Editing surface padding, so a host can match the pane it replaced. */
  padding?: string;
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

/** Replace the selection with plain text (an uploaded image reference). */
function insertText(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
  view.focus();
}

const TABLE_SNIPPET = "| Column | Column |\n| --- | --- |\n|  |  |";

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onUploadImage,
  placeholder,
  ariaLabel,
  toolbar = true,
  fontSize = 13,
  padding,
}: MarkdownEditorProps) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const viewRef = useRef<EditorView | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onCreateEditor = useCallback((view: EditorView) => {
    viewRef.current = view;
  }, []);

  const withView = useCallback((fn: (view: EditorView) => void) => {
    const view = viewRef.current;
    if (view) fn(view);
  }, []);

  // Upload each picked / dropped / pasted image, then insert its reference.
  const handleFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!onUploadImage || !files || files.length === 0) return;
      for (const file of Array.from(files)) {
        const url = await onUploadImage(file);
        if (!url) continue;
        const alt = file.name.replace(/\.(png|jpe?g|gif|webp|svg|avif)$/i, "");
        withView((view) => insertText(view, `![${alt}](${url})\n`));
      }
    },
    [onUploadImage, withView],
  );

  const extensions = useMemo(() => {
    const extensions = [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      // Markdown keyboard shortcuts (Cmd/Ctrl+B, I, K, Mod-E code block,
      // Mod-Shift-K task list).
      keymap.of([
        { key: "Mod-b", run: (view) => (toggleWrap(view, "**", "**", "bold"), true) },
        { key: "Mod-i", run: (view) => (toggleWrap(view, "*", "*", "italic"), true) },
        { key: "Mod-k", run: (view) => (toggleWrap(view, "[", "](url)", "text"), true) },
        { key: "Mod-e", run: (view) => (insertBlock(view, "```\n\n```"), true) },
        { key: "Mod-Shift-k", run: (view) => (toggleLinePrefix(view, "- [ ] "), true) },
        ...(onSave
          ? [{ key: "Mod-s", run: () => (onSave(), true) }]
          : []),
      ]),
    ];
    if (padding !== undefined) {
      extensions.push(EditorView.theme({ ".cm-content": { padding } }));
    }
    if (ariaLabel !== undefined) {
      extensions.push(EditorView.contentAttributes.of({ "aria-label": ariaLabel }));
    }
    return extensions;
  }, [onSave, padding, ariaLabel]);

  const toolbarGroups: ReactNode[][] = [
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
      ...(onUploadImage
        ? [
            <IconButton key="img" label={t("Insert image")} size="xs" onClick={() => fileInputRef.current?.click()}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-4.5-4.5L7 20" /></svg>
            </IconButton>,
          ]
        : []),
    ],
  ];

  return (
    <div
      data-editor-root
      className="cm-editor-scoped"
      style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", minHeight: 0 }}
      onPaste={(e) => {
        if (!onUploadImage) return;
        const files = e.clipboardData?.files;
        if (files && files.length > 0) {
          e.preventDefault();
          void handleFiles(files);
        }
      }}
      onDrop={(e) => {
        if (!onUploadImage) return;
        e.preventDefault();
        void handleFiles(e.dataTransfer?.files ?? null);
      }}
      onDragOver={(e) => {
        if (onUploadImage) e.preventDefault();
      }}
    >
      {toolbar && (
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
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <CodeMirror
          value={value}
          onChange={(v) => onChange(v)}
          onCreateEditor={onCreateEditor}
          extensions={extensions}
          placeholder={placeholder}
          theme={isDark ? "dark" : "light"}
          basicSetup={{ foldGutter: true, autocompletion: true, highlightActiveLine: true }}
          height="100%"
          style={{ height: "100%", fontSize }}
        />
      </div>
    </div>
  );
}
