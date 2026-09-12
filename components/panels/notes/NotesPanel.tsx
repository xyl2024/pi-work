"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  fetchNote,
  fetchNotesTree,
  saveNote,
} from "@/lib/client/notes";
import type { NoteNode } from "@/lib/shared/notes";
import { NotePreview } from "./NotePreview";
import { NotesEditor } from "./NotesEditor";
import { NotesList } from "./NotesList";

type SaveStatus = "saved" | "unsaved" | "saving";

interface NotesPanelProps {
  /** True when the right panel is in the expanded (wide) state. */
  expanded: boolean;
}

const AUTOSAVE_MS = 600;

export function NotesPanel({ expanded }: NotesPanelProps) {
  const { t } = useI18n();
  const [tree, setTree] = useState<NoteNode[]>([]);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  // Narrow mode: which pane is shown (edit vs preview).
  const [narrowMode, setNarrowMode] = useState<"edit" | "preview">("edit");

  const contentRef = useRef("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openNoteRef = useRef<string | null>(null);
  const flushing = useRef(false);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  useEffect(() => {
    openNoteRef.current = openNote;
  }, [openNote]);

  const refresh = useCallback(async () => {
    try {
      setTree(await fetchNotesTree());
    } catch {
      /* keep last tree */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const flushSave = useCallback(async (note: string | null) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!note || flushing.current) return;
    const c = contentRef.current;
    if (c === null) return;
    flushing.current = true;
    setSaveStatus("saving");
    try {
      await saveNote(note, c);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("unsaved");
    } finally {
      flushing.current = false;
    }
  }, []);

  // Flush pending save when leaving the editor / switching notes.
  const open = useCallback(
    async (rel: string) => {
      await flushSave(openNoteRef.current);
      setOpenNote(rel);
      setNarrowMode("preview");
      const n = await fetchNote(rel);
      contentRef.current = n.content;
      setContent(n.content);
      setSaveStatus("saved");
    },
    [flushSave],
  );

  const back = useCallback(() => {
    flushSave(openNoteRef.current);
    setOpenNote(null);
    contentRef.current = "";
    setContent("");
    setSaveStatus("saved");
    refresh();
  }, [flushSave, refresh]);

  const handleChange = useCallback(
    (next: string) => {
      contentRef.current = next;
      setContent(next);
      setSaveStatus("unsaved");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const note = openNoteRef.current;
        if (!note) return;
        flushSave(note);
      }, AUTOSAVE_MS);
    },
    [flushSave],
  );

  // Shortcut: toggle edit/preview pane in narrow mode (Cmd/Ctrl+Shift+P).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
        // Save now (Cmd/Ctrl+S). Flush any pending autosave.
        if (!openNoteRef.current) return;
        e.preventDefault();
        flushSave(openNoteRef.current);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flushSave]);

  // ── Editor view (open note) ──
  if (openNote) {
    const title = openNote.split("/").pop() ?? openNote;
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 34,
            padding: "0 8px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <BackButton title={t("Back to list")} onClick={back} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--text)",
            }}
            title={title}
          >
            {title.replace(/\.md$/i, "")}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              color: saveStatus === "saved" ? "var(--text-dim)" : saveStatus === "saving" ? "var(--text-muted)" : "#f87171",
            }}
          >
            {saveStatus === "saved"
              ? t("Saved")
              : saveStatus === "saving"
                ? t("Saving")
                : t("Unsaved changes")}
          </span>
          {!expanded && (
            <ModeToggle mode={narrowMode} onChange={setNarrowMode} />
          )}
        </div>

        {/* Body: expanded → split edit|preview; normal → single pane. */}
        {expanded ? (
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <div style={{ flex: "1 1 50%", minWidth: 0, borderRight: "1px solid var(--border)" }}>
              <NotesEditor noteRel={openNote} value={content} onChange={handleChange} onSave={() => flushSave(openNote)} />
            </div>
            <div style={{ flex: "1 1 50%", minWidth: 0, overflowY: "auto" }}>
              <PreviewPane noteRel={openNote} content={content} />
            </div>
          </div>
        ) : narrowMode === "edit" ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <NotesEditor noteRel={openNote} value={content} onChange={handleChange} onSave={() => flushSave(openNote)} />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <PreviewPane noteRel={openNote} content={content} />
          </div>
        )}
      </div>
    );
  }

  // ── List view ──
  return (
    <NotesList
      tree={tree}
      activeNote={openNote}
      onOpenNote={open}
      onChanged={refresh}
    />
  );
}

function PreviewPane({ noteRel, content }: { noteRel: string; content: string }) {
  return (
    <div style={{ padding: "12px 14px", minHeight: "100%" }}>
      <NotePreview noteRel={noteRel} content={content} />
    </div>
  );
}

function BackButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        flexShrink: 0,
        color: "var(--text-muted)",
        background: "transparent",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        padding: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-selected)"; e.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  );
}

function ModeToggle({ mode, onChange }: { mode: "edit" | "preview"; onChange: (m: "edit" | "preview") => void }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        flexShrink: 0,
        height: 24,
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <ModeTab active={mode === "edit"} label={t("Edit")} onClick={() => onChange("edit")} />
      <ModeTab active={mode === "preview"} label={t("Preview")} onClick={() => onChange("preview")} />
    </div>
  );
}

function ModeTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "0 10px",
        fontSize: 11,
        color: active ? "var(--accent)" : "var(--text-muted)",
        background: active ? "var(--bg-selected)" : "transparent",
        border: "none",
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}