"use client";

import { useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
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

/** Count note files in a tree (assets dirs are already excluded server-side). */
function countNotes(tree: NoteNode[]): number {
  let n = 0;
  for (const node of tree) {
    if (node.type === "file") n += 1;
    else n += countNotes(node.children ?? []);
  }
  return n;
}

/** Filter a tree by a case-insensitive name query, keeping the ancestor
 *  chain of every match. Returns the filtered tree plus the set of folder
 *  paths that must stay expanded while filtering. */
function filterTree(tree: NoteNode[], query: string): { filtered: NoteNode[]; forceExpanded: Set<string> } {
  const q = query.trim().toLowerCase();
  if (!q) return { filtered: tree, forceExpanded: new Set() };
  const forceExpanded = new Set<string>();
  const walk = (nodes: NoteNode[]): NoteNode[] => {
    const out: NoteNode[] = [];
    for (const node of nodes) {
      if (node.type === "file") {
        if (node.name.toLowerCase().includes(q)) out.push(node);
        continue;
      }
      const children = walk(node.children ?? []);
      if (children.length > 0 || node.name.toLowerCase().includes(q)) {
        if (children.length > 0) forceExpanded.add(node.path);
        out.push({ ...node, children });
      }
    }
    return out;
  };
  return { filtered: walk(tree), forceExpanded };
}

export function NotesList({ tree, activeNote, onOpenNote, onChanged }: NotesListProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tree.filter((n) => n.type === "folder").map((n) => n.path)),
  );
  const [create, setCreate] = useState<CreateBar | null>(null);
  const [creating, setCreating] = useState(false);
  const [nameValue, setNameValue] = useState("");

  const allFolders = useMemo(() => collectFolders(tree), [tree]);
  const noteCount = useMemo(() => countNotes(tree), [tree]);
  const { filtered, forceExpanded } = useMemo(() => filterTree(tree, query), [tree, query]);

  const toggleExpand = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const openCreate = (type: "note" | "folder", dir: string) => {
    setCreate({ type, dir });
    setNameValue("");
  };

  const submitCreate = async () => {
    if (!create || !nameValue.trim()) return;
    setCreating(true);
    try {
      if (create.type === "folder") {
        await createFolder(create.dir, nameValue.trim());
      } else {
        const note = await createNote(create.dir, nameValue.trim());
        setCreate(null);
        setNameValue("");
        onChanged();
        onOpenNote(note.path);
        return;
      }
      setCreate(null);
      setNameValue("");
      onChanged();
    } catch (err) {
      toast.show({ kind: "error", message: t("Operation failed"), description: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreating(false);
    }
  };

  const filtering = query.trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header: title + count, primary actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px 6px",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{t("Notes")}</span>
        {noteCount > 0 && (
          <span
            style={{
              fontSize: 10.5,
              lineHeight: "16px",
              padding: "0 6px",
              borderRadius: 8,
              color: "var(--text-dim)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
            }}
          >
            {noteCount}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <IconButton label={t("New folder")} size="xs" onClick={() => openCreate("folder", "")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M12 10v6M9 13h6" />
          </svg>
        </IconButton>
        <IconButton label={t("New note")} size="xs" variant="subtle" onClick={() => openCreate("note", "")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </IconButton>
      </div>

      {/* Search */}
      <div style={{ padding: "0 10px 8px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 8px",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            transition: "border-color 0.12s",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={t("Search notes...")}
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              fontSize: 12,
              color: "var(--text)",
              background: "transparent",
              border: "none",
              outline: "none",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 14,
                height: 14,
                flexShrink: 0,
                color: "var(--text-dim)",
                background: "transparent",
                border: "none",
                borderRadius: 3,
                cursor: "pointer",
                padding: 0,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Inline create bar */}
      {create && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            margin: "0 10px 8px",
            padding: "5px 6px 5px 8px",
            background: "var(--bg-subtle)",
            border: "1px solid var(--accent)",
            borderRadius: 6,
            flexShrink: 0,
          }}
        >
          <span style={{ color: "var(--accent)", display: "inline-flex", flexShrink: 0 }}>
            {create.type === "folder" ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            )}
          </span>
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
              height: 22,
              fontSize: 12,
              color: "var(--text)",
              background: "transparent",
              border: "none",
              outline: "none",
            }}
          />
          <IconButton label={t("Cancel")} size="xs" tooltip={false} onClick={() => { setCreate(null); setNameValue(""); }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </IconButton>
          <IconButton label={t("Create")} size="xs" variant="primary" disabled={creating || !nameValue.trim()} onClick={submitCreate}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </IconButton>
        </div>
      )}

      {/* Tree */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 6px 12px" }}>
        {tree.length === 0 ? (
          <NotesEmptyState onCreate={() => openCreate("note", "")} />
        ) : filtered.length === 0 ? (
          <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("No matching notes")}
          </div>
        ) : (
          filtered.map((node) => (
            <TreeNode
              key={node.path || node.name}
              node={node}
              depth={0}
              expanded={filtering ? forceExpanded : expanded}
              forceExpanded={filtering}
              activeNote={activeNote}
              onToggle={toggleExpand}
              onOpen={onOpenNote}
              onChanged={onChanged}
              allFolders={allFolders}
              onCreateHere={(dir) => openCreate("note", dir)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function NotesEmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 20px", textAlign: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: 12,
          color: "var(--text-dim)",
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M12 12v6M9 15h6" />
        </svg>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", fontWeight: 500 }}>{t("No notes yet")}</div>
      <button
        type="button"
        onClick={onCreate}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 12px",
          fontSize: 12,
          fontWeight: 500,
          color: "#fff",
          background: "var(--accent)",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          transition: "background 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        {t("Create your first note")}
      </button>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  forceExpanded,
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
  forceExpanded: boolean;
  activeNote: string | null;
  onToggle: (p: string) => void;
  onOpen: (rel: string) => void;
  onChanged: () => void;
  allFolders: { path: string; name: string }[];
  onCreateHere: (dir: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const isFolder = node.type === "folder";
  const isOpen = forceExpanded || expanded.has(node.path);
  const [picker, setPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [busy, setBusy] = useState(false);
  // When true, the pending blur after Escape must not commit the rename.
  const renameCancelledRef = useRef(false);

  const runDelete = async () => {
    const ok = await confirm({
      title: isFolder ? t("Delete folder") : t("Delete note"),
      description: isFolder ? t("Confirm delete folder") : t("Confirm delete note"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteEntry(node.path);
      onChanged();
    } catch (err) {
      toast.show({ kind: "error", message: t("Operation failed"), description: err instanceof Error ? err.message : String(err) });
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
    } catch (err) {
      toast.show({ kind: "error", message: t("Operation failed"), description: err instanceof Error ? err.message : String(err) });
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
    } catch (err) {
      toast.show({ kind: "error", message: t("Operation failed"), description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const isActive = !isFolder && node.path === activeNote;
  const childFolders = (node.children ?? []).filter((c) => c.type === "folder");
  const childFiles = (node.children ?? []).filter((c) => c.type === "file");
  const childCount = childFolders.length + childFiles.length;

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <div style={{ position: "relative" }}>
        <div
          className="notes-row"
          onContextMenu={(e) => {
            e.preventDefault();
            setPicker(true);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 27,
            padding: "0 6px",
            borderRadius: 6,
            cursor: "pointer",
            position: "relative",
            background: isActive ? "var(--bg-selected)" : "transparent",
            color: isActive ? "var(--accent)" : "var(--text)",
            transition: "background 0.1s ease, color 0.1s ease",
            opacity: busy ? 0.55 : 1,
            pointerEvents: busy ? "none" : undefined,
          }}
          onClick={() => {
            if (renaming) return;
            if (isFolder) onToggle(node.path);
            else onOpen(node.path);
          }}
          onMouseEnter={(e) => {
            if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (!isActive) e.currentTarget.style.background = "transparent";
          }}
        >
          {/* chevron / icon */}
          <span style={{ display: "inline-flex", width: 14, flexShrink: 0, color: isActive ? "var(--accent)" : "var(--text-dim)" }}>
            {isFolder ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}>
                <polyline points="9 6 15 12 9 18" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
              onFocus={(e) => {
                renameCancelledRef.current = false;
                // Pre-select the stem so typing replaces it, keeping ".md".
                const dot = node.name.lastIndexOf(".");
                e.currentTarget.setSelectionRange(0, dot > 0 ? dot : node.name.length);
              }}
              onBlur={() => {
                if (!renameCancelledRef.current) runRename();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { renameCancelledRef.current = true; runRename(); }
                if (e.key === "Escape") { renameCancelledRef.current = true; setRenaming(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                minWidth: 0,
                height: 21,
                padding: "0 6px",
                fontSize: 12,
                color: "var(--text)",
                background: "var(--bg)",
                border: "1px solid var(--accent)",
                borderRadius: 4,
                outline: "none",
              }}
            />
          ) : (
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: isActive ? 600 : 400 }}>
              {formatLabel(node.name)}
            </span>
          )}

          {/* folder child count (subtle, fades out on hover) */}
          {isFolder && !renaming && childCount > 0 && (
            <span
              className="notes-row-meta"
              style={{ fontSize: 10.5, color: "var(--text-dim)", flexShrink: 0 }}
            >
              {childCount}
            </span>
          )}

          {/* hover actions (overlay the meta, revealed on row hover) */}
          {!renaming && (
            <span className="notes-row-actions" style={{ display: "flex", gap: 1, flexShrink: 0 }}>
              {isFolder ? (
                <HoverIcon title={t("New note in folder")} onClick={(e) => { e.stopPropagation(); onCreateHere(node.path); }}>
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
                title={isFolder ? t("Rename folder") : t("Rename note")}
                onClick={(e) => { e.stopPropagation(); setRenaming(true); setRenameValue(node.name); }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
              </HoverIcon>
              <HoverIcon
                title={isFolder ? t("Delete folder") : t("Delete note")}
                onClick={(e) => { e.stopPropagation(); runDelete(); }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
              </HoverIcon>
            </span>
          )}
        </div>

        {/* Move-to popover, anchored under this row */}
        {picker && (
          <NoteFolderPicker
            folders={allFolders.filter((f) => f.path !== node.path && !node.path.startsWith(`${f.path}/`))}
            onPick={runMove}
            onClose={() => setPicker(false)}
          />
        )}
      </div>

      {/* Empty folder hint */}
      {isFolder && isOpen && childCount === 0 && (
        <div style={{ padding: "3px 6px 6px 28px", color: "var(--text-dim)", fontSize: 11 }}>
          {t("No notes in this folder")}
        </div>
      )}

      {isFolder && isOpen && childFolders.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          forceExpanded={forceExpanded}
          activeNote={activeNote}
          onToggle={onToggle}
          onOpen={onOpen}
          onChanged={onChanged}
          allFolders={allFolders}
          onCreateHere={onCreateHere}
        />
      ))}
      {isFolder && isOpen && childFiles.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          forceExpanded={forceExpanded}
          activeNote={activeNote}
          onToggle={onToggle}
          onOpen={onOpen}
          onChanged={onChanged}
          allFolders={allFolders}
          onCreateHere={onCreateHere}
        />
      ))}
    </div>
  );
}

/* Row action icon button (unified Tooltip style) */
function HoverIcon({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <Tooltip content={title} delayDuration={400}>
      <button
        type="button"
        onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 19,
        height: 19,
        color: "var(--text-dim)",
        background: "transparent",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
        padding: 0,
        transition: "background 0.1s, color 0.1s",
      }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--bg-selected)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "transparent"; }}
      >
        {children}
      </button>
    </Tooltip>
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
