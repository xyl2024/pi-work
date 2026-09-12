"use client";

import { useCallback, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { useTheme } from "@/hooks/useTheme";
import { uploadNoteImage } from "@/lib/client/notes";

interface NotesEditorProps {
  noteRel: string;
  value: string;
  onChange: (next: string) => void;
  /** Triggered on Cmd/Ctrl+S for an immediate save. */
  onSave?: () => void;
}

/** Run a markdown wrap/insert on an editor view. Dispatches a change (which
 *  @uiw/react-codemirror reports back through onChange automatically). */
function runInsert(view: EditorView, before: string, after: string, placeholder?: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to) || placeholder || "";
  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length + selected.length },
  });
  view.focus();
}

function prefixLines(view: EditorView, prefix: string) {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to).number;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = startLine.number; n <= endLine; n++) {
    const line = view.state.doc.line(n);
    changes.push({ from: line.from, to: line.from, insert: prefix });
  }
  view.dispatch({ changes });
  view.focus();
}

export function NotesEditor({ noteRel, value, onChange, onSave }: NotesEditorProps) {
  const { isDark } = useTheme();
  const viewRef = useRef<EditorView | null>(null);

  const onCreateEditor = useCallback((view: EditorView) => {
    viewRef.current = view;
  }, []);

  // Upload a picked/dropped/pasted image file, then insert its reference.
  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      try {
        const { url } = await uploadNoteImage(noteRel, file);
        const view = viewRef.current;
        if (view) runInsert(view, `![${file.name.replace(/\.(png|jpe?g|gif|webp|svg|avif)$/i, "")}](${url})\n`, "");
      } catch {
        /* ignore upload errors */
      }
    },
    [noteRel],
  );

  // Markdown keyboard shortcuts (Cmd/Ctrl+B, I, K, Mod-E code block, Mod-Shift-L list).
  const bindings = [
    { key: "Mod-b", run: (view: EditorView) => (runInsert(view, "**", "**", "bold"), true) },
    { key: "Mod-i", run: (view: EditorView) => (runInsert(view, "*", "*", "italic"), true) },
    { key: "Mod-k", run: (view: EditorView) => (runInsert(view, "[", "](url)", "text"), true) },
    { key: "Mod-e", run: (view: EditorView) => (runInsert(view, "```\n", "\n```", "code"), true) },
    { key: "Mod-Shift-k", run: (view: EditorView) => (prefixLines(view, "- [ ] "), true) },
    { key: "Mod-s", run: () => { onSave?.(); return true; } },
  ];
  const extensions = [
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    keymap.of(bindings),
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