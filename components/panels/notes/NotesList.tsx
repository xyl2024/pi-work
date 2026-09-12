"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  createFolder,
  createNote,
  deleteEntry,
  moveEntry,
  renameEntry,
} from "@/lib/client/notes";
import {
  isNoteAssetsDir,
  type NoteNode,
} from "@/lib/shared/notes";
import { NoteFolderPicker } from "./NotesRowActions";

interface NotesListProps {
  tree: NoteNode[];
  activeNote: string | null;
  onOpenNote: (rel: string) => void;
  onChanged: () => void; // refresh tree + any derived state
}

interface CreateBar {
  type: "note" | "folder";
  dir: string;
}

export function NotesList({ tree, activeNote, onOpenNote, onChanged }: NotesListProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tree.filter((n) => n.type === "folder").map((n) => n.path)),
  );
  const [create, setCreate] = useState<CreateBar | null>(null);
  const [creating, setCreating] = useState(false);
  const [nameValue, setNameValue] = useState("");

  const allFolders = useMemo(() => collectFolders(tree), [tree]);

  const toggleExpand = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const submitCreate = async () => {
    if (!create || !nameValue.trim()) return;
    setCreating(true);
    try {
      if (create.type === "folder") {
        await createFolder(create.dir, nameValue.trim());
      } else {
        const note = await createNote(create.dir, nameValue.trim());
        onOpenNote(note.path);
      }
      setCreate(null);
      setNameValue("");
      onChanged();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header / create bar */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "8px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <MiniButton label={t("New note")} onClick={() => { setCreate({ type: "note", dir: "" }); setNameValue(""); }} />
        <MiniButton label={t("New folder")} onClick={() => { setCreate({ type: "folder", dir: "" }); setNameValue(""); }} />
      </div>

      {create && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-subtle)",
          }}
        >
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") { setCreate(null); setNameValue(""); }
            }}
            placeholder={create.type === "folder" ? t("Folder name") : t("Note title")}
            style={{
              flex: 1,
              minWidth: 0,
              height: 26,
              padding: "0 8px",
              fontSize: 12,
              color: "var(--text)",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 5,
            }}
          />
          <MiniButton label={t("Create")} onClick={submitCreate} disabled={creating || !nameValue.trim()} primary />
        </div>
      )}

      {/* Tree */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 6px 12px" }}>
        {tree.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("No notes yet")}
            <div style={{ marginTop: 8 }}>
              <MiniButton label={t("Create your first note")} onClick={() => { setCreate({ type: "note", dir: "" }); setNameValue(""); }} primary />
            </div>
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.path || node.name}
              node={node}
              depth={0}
              expanded={expanded}
              activeNote={activeNote}
              onToggle={toggleExpand}
              onOpen={onOpenNote}
              onChanged={onChanged}
              allFolders={allFolders}
              onCreateHere={(dir) => { setCreate({ type: "note", dir }); setNameValue(""); }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  activeNote,
  onToggle,
  onOpen,
  onChanged,
  allFolders,
  onCreateHere,
}: {
  node: NoteNode;
  depth: number;
  expanded: Set<string>;
  activeNote: string | null;
  onToggle: (p: string) => void;
  onOpen: (rel: string) => void;
  onChanged: () => void;
  allFolders: { path: string; name: string }[];
  onCreateHere: (dir: string) => void;
}) {
  const { t } = useI18n();
  const isFolder = node.type === "folder";
  const isOpen = expanded.has(node.path);
  const [picker, setPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [busy, setBusy] = useState(false);

  const runDelete = async () => {
    if (!window.confirm(isFolder ? t("Confirm delete folder") : t("Confirm delete note"))) return;
    setBusy(true);
    try {
      await deleteEntry(node.path);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const runRename = async () => {
    const v = renameValue.trim();
    if (!v || v === node.name || busy) return;
    setBusy(true);
    try {
      await renameEntry(node.path, isFolder ? v : v.replace(/\.md$/i, ""));
      setRenaming(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const runMove = async (destDir: string) => {
    setBusy(true);
    try {
      await moveEntry(node.path, destDir);
      setPicker(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const isActive = !isFolder && node.path === activeNote;

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          setPicker(true);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 6px",
          borderRadius: 6,
          cursor: isFolder ? "pointer" : "pointer",
          position: "relative",
          background: isActive ? "var(--bg-selected)" : "transparent",
          color: isActive ? "var(--accent)" : "var(--text)",
        }}
        onClick={() => {
          if (renaming) return;
          if (isFolder) onToggle(node.path);
          else onOpen(node.path);
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = "var(--bg-selected)";
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* chevron / icon */}
        <span style={{ display: "inline-flex", width: 14, flexShrink: 0, color: "var(--text-dim)" }}>
          {isFolder ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>
              <polyline points="9 6 15 12 9 18" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          )}
        </span>

        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={runRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") runRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              minWidth: 0,
              height: 22,
              padding: "0 6px",
              fontSize: 12,
              color: "var(--text)",
              background: "var(--bg)",
              border: "1px solid var(--accent)",
              borderRadius: 4,
            }}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>
            {formatLabel(node.name)}
          </span>
        )}

        {/* hover actions */}
        {!renaming && (
          <span style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            {isFolder ? (
              <HoverIcon
                title={t("New note")}
                onClick={(e) => { e.stopPropagation(); onCreateHere(node.path); }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              </HoverIcon>
            ) : null}
            <HoverIcon
              title={t("Move to")}
              onClick={(e) => { e.stopPropagation(); setPicker(true); }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9l-3 3 3 3" /><path d="M9 5h2a5 5 0 0 1 0 10h-3" /></svg>
            </HoverIcon>
            <HoverIcon
              title={t("Rename note")}
              onClick={(e) => { e.stopPropagation(); setRenaming(true); setRenameValue(node.name); }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            </HoverIcon>
            <HoverIcon
              title={t("Delete note")}
              onClick={(e) => { e.stopPropagation(); runDelete(); }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
            </HoverIcon>
          </span>
        )}
      </div>

      {/* Render a sub-list inline (folders print one or two entries) */}
      {isFolder && isOpen && (node.children ?? []).length === 0 && (
        <div style={{ padding: "2px 6px 6px 26px", color: "var(--text-dim)", fontSize: 11 }}>
          {t("No notes in this folder")}
        </div>
      )}

      {isFolder && isOpen &&
        (node.children ?? []).filter((c) => c.type === "folder").map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            activeNote={activeNote}
            onToggle={onToggle}
            onOpen={onOpen}
            onChanged={onChanged}
            allFolders={allFolders}
            onCreateHere={onCreateHere}
          />
        ))}
      {isFolder && isOpen &&
        (node.children ?? []).filter((c) => c.type === "file").map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            activeNote={activeNote}
            onToggle={onToggle}
            onOpen={onOpen}
            onChanged={onChanged}
            allFolders={allFolders}
            onCreateHere={onCreateHere}
          />
        ))}

      {picker && (
        <NoteFolderPicker
          folders={allFolders.filter((f) => f.path !== node.path)}
          onPick={runMove}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

/* Row action icon button */
function HoverIcon({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        color: "var(--text-dim)",
        background: "transparent",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
        padding: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-subtle)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

export function MiniButton({ label, onClick, disabled, primary }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 24,
        padding: "0 9px",
        fontSize: 11,
        cursor: disabled ? "default" : "pointer",
        color: primary ? "#fff" : "var(--text-muted)",
        background: primary ? "var(--accent)" : "var(--bg-selected)",
        border: `1px solid ${primary ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 5,
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function collectFolders(tree: NoteNode[]): { path: string; name: string }[] {
  const out: { path: string; name: string }[] = [];
  const walk = (nodes: NoteNode[]) => {
    for (const n of nodes) {
      if (n.type === "folder") {
        out.push({ path: n.path, name: n.name });
        walk(n.children ?? []);
      }
    }
  };
  walk(tree);
  return out;
}

function formatLabel(name: string): string {
  return isNoteAssetsDir(name) ? name.replace(/\.assets$/, "") : name;
}