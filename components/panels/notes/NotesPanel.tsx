"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  fetchNote,
  fetchNotesTree,
  saveNote,
} from "@/lib/client/notes";
import type { NoteNode } from "@/lib/shared/notes";
import { NotePreview } from "./NotePreview";
import { NotesEditor } from "./NotesEditor";
import { NotesList } from "./NotesList";

type SaveStatus = "saved" | "unsaved" | "saving" | "error";

interface NotesPanelProps {
  /** True when the right panel is in the expanded (wide) state. */
  expanded: boolean;
}

const AUTOSAVE_MS = 600;

/** Word count that treats CJK characters as one "word" each and groups
 *  latin/digit runs into words — the usual convention for mixed text. */
function countWords(content: string): number {
  if (!content.trim()) return 0;
  const cjk = content.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length ?? 0;
  const latin = content.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + latin;
}

export function NotesPanel({ expanded }: NotesPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
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

  const flushSave = useCallback(async (note: string | null, notify = false) => {
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
      if (notify) toast.show({ kind: "success", message: t("Notes saved") });
    } catch {
      setSaveStatus("error");
      if (notify) toast.show({ kind: "error", message: t("Save failed") });
    } finally {
      flushing.current = false;
    }
  }, [t, toast]);

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

  // Shortcut: save now (Cmd/Ctrl+S). Flushes any pending autosave.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
        if (!openNoteRef.current) return;
        e.preventDefault();
        flushSave(openNoteRef.current, true);
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
            gap: 6,
            height: 36,
            padding: "0 8px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <IconButton label={t("Back to list")} size="xs" onClick={back}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </IconButton>
          <Tooltip content={title} delayDuration={400}>
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
            >
              {title.replace(/\.md$/i, "")}
            </span>
          </Tooltip>
          {!expanded && <ModeToggle mode={narrowMode} onChange={setNarrowMode} />}
        </div>

        {/* Body: expanded → split edit|preview; normal → single pane. */}
        {expanded ? (
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <div style={{ flex: "1 1 50%", minWidth: 0, borderRight: "1px solid var(--border)" }}>
              <NotesEditor noteRel={openNote} value={content} onChange={handleChange} onSave={() => flushSave(openNote, true)} />
            </div>
            <div style={{ flex: "1 1 50%", minWidth: 0, overflowY: "auto" }}>
              <PreviewPane noteRel={openNote} content={content} />
            </div>
          </div>
        ) : narrowMode === "edit" ? (
          <div className="notes-fade-in" style={{ flex: 1, minHeight: 0 }}>
            <NotesEditor noteRel={openNote} value={content} onChange={handleChange} onSave={() => flushSave(openNote, true)} />
          </div>
        ) : (
          <div className="notes-fade-in" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <PreviewPane noteRel={openNote} content={content} />
          </div>
        )}

        {/* Footer status bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            height: 24,
            padding: "0 10px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
            fontSize: 11,
            color: "var(--text-dim)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span>{countWords(content)} {t("Words")}</span>
            <span style={{ color: "var(--border)" }}>·</span>
            <span>{content.length} {t("Characters")}</span>
          </span>
          <span style={{ flex: 1 }} />
          <SaveStatusIndicator status={saveStatus} />
        </div>
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
    <div style={{ padding: "12px 16px 24px", minHeight: "100%" }}>
      <NotePreview noteRel={noteRel} content={content} />
    </div>
  );
}

const STATUS_META: Record<SaveStatus, { color: string; pulse?: boolean }> = {
  saved: { color: "var(--success)" },
  saving: { color: "var(--text-dim)", pulse: true },
  unsaved: { color: "var(--warning)" },
  error: { color: "var(--error)" },
};

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  const label = status === "saved"
    ? t("Saved")
    : status === "saving"
      ? t("Saving")
      : status === "error"
        ? t("Save failed")
        : t("Unsaved changes");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
      <span
        className={meta.pulse ? "notes-saving-dot" : undefined}
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: meta.color,
          flexShrink: 0,
        }}
      />
      <span style={{ color: status === "error" ? "var(--error)" : "var(--text-dim)" }}>{label}</span>
    </span>
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
        padding: 2,
        gap: 2,
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
        borderRadius: 7,
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
        height: 18,
        lineHeight: "18px",
        color: active ? "var(--accent)" : "var(--text-muted)",
        background: active ? "var(--bg-selected)" : "transparent",
        border: "none",
        borderRadius: 5,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {label}
    </button>
  );
}
