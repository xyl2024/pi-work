"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { getFileIcon, FolderIcon } from "./FileIcons";
import { encodeFilePathForApi, getRelativeFilePath, joinFilePath } from "@/lib/shared/file-paths";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../ui/Tooltip";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { validateFileName } from "@/lib/shared/file-name";
import { FileGitBadge, gitStatusColor } from "./FileGitBadge";
import { useGitStatusStore, aggregateFolderStatuses, startTracking, stopTracking } from "@/lib/client/git-status-store";
import { createEntry, duplicateEntry, moveEntry, pickFiles, uploadFilesToDir, type ExplorerCreateKind } from "@/lib/client/file-explorer-mutations";
import { copyText as copyToClipboard } from "@/lib/client/clipboard";
import type { GitDiffFile, GitFileStatus } from "@/lib/shared/git-diff-types";

/** Drag-and-drop MIME used to move entries between folders. A custom type
 *  (rather than `text/plain`) lets us ignore OS file drops and other
 *  unrelated drags during dragover. */
const DRAG_MIME = "application/x-pi-file-path";

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
  onAtMention?: (filePath: string) => void;
  onFileMutated?: () => void;
  onFileDeleted?: (filePath: string) => void;
  /** Bump to collapse every expanded folder. Initial value (or undefined)
   *  is ignored — only subsequent increments trigger a collapse. */
  collapseKey?: number;
  /** Reports the current number of expanded folders. The parent uses this
   *  to disable its "collapse all" button while the tree is already fully
   *  folded (nothing left to collapse). */
  onExpandedCountChange?: (count: number) => void;
}

async function fetchEntries(dirPath: string): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list`);
  if (!res.ok) return [];
  const data = await res.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
  }));
}

/** Trigger a browser download for a file or directory. Directories are
 *  zipped server-side (see the `type=download` branch of the files GET). */
function triggerDownload(fullPath: string, filename: string) {
  const a = document.createElement("a");
  a.href = `/api/files/${encodeFilePathForApi(fullPath)}?type=download`;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Git status helpers ─────────────────────────────────────────────────────

/** Stable empty array used as the fallback when the store has no entry for
 *  the current cwd yet. Module-scoped so the reference is identical across
 *  renders — critical for keeping the `useMemo` deps stable. */
const EMPTY_GIT_FILES: GitDiffFile[] = [];

/** Stable empty aggregate map (no status means "no badge"); same rationale
 *  as EMPTY_GIT_FILES. */
const EMPTY_GIT_AGGREGATE: Map<string, GitFileStatus> = new Map();

/** Stable empty file-by-path map; same rationale as EMPTY_GIT_FILES. */
const EMPTY_GIT_FILES_BY_PATH: Map<string, GitDiffFile> = new Map();

/** Tooltip status line for a single file. Matches the format we agreed on
 *  in the design grill — status letter + parenthetical stage hint + stats.
 *  Examples:
 *    "M (worktree + staged) · +12 -3"
 *    "A (staged) · +45"
 *    "Untracked · +5"
 *  Returns undefined when the file has no git status (caller falls back to
 *  the default full-path tooltip). */
function fileTooltip(file: GitDiffFile, t: (k: string) => string): string {
  const stats = file.status === "??"
    ? (file.additions > 0 ? ` · +${file.additions}` : "")
    : (file.additions || file.deletions)
      ? ` · +${file.additions} -${file.deletions}`
      : "";
  const stage = stageHint(file, t);
  const head = statusHead(file.status, t);
  return stage ? `${head} (${stage})${stats}` : `${head}${stats}`;
}

/** Tooltip status line for a folder. Just calls statusHead — defined as
 *  a separate function for symmetry with fileTooltip; could grow a file
 *  count later if the worst-status header turns out to be insufficient. */
function folderTooltip(status: GitFileStatus, t: (k: string) => string): string {
  return statusHead(status, t);
}

function statusHead(status: GitFileStatus, t: (k: string) => string): string {
  switch (status) {
    case "A": return t("Added");
    case "M": return t("Modified");
    case "D": return t("Deleted");
    case "R": return t("Renamed");
    case "C": return t("Git status copied");
    case "T": return t("Type changed");
    case "U": return t("Conflict");
    case "??": return t("Untracked");
  }
}

function stageHint(file: GitDiffFile, t: (k: string) => string): string {
  if (file.hasStaged && file.hasUnstaged) return `${t("Staged")} + ${t("Unstaged")}`;
  if (file.hasStaged) return t("Staged");
  if (file.hasUnstaged) return t("Unstaged");
  return "";
}

function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshKey,
  onFileMutated,
  onFileDeleted,
  gitFilesByPath,
  gitAggregate,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (filePath: string) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshKey?: number;
  onFileMutated?: () => void;
  onFileDeleted?: (filePath: string) => void;
  /** Map of cwd-relative file path → GitDiffFile. Built once at the
   *  FileExplorer level from the store snapshot. Children of every
   *  TreeNode in the recursive chain read from the same reference, so
   *  per-node lookup is O(1) and there's no recomputation as the user
   *  expands/collapses subtrees. */
  gitFilesByPath: Map<string, GitDiffFile>;
  /** Map of cwd-relative directory path → worst recursive status. Pre-
   *  computed once per fetch via `aggregateFolderStatuses`. The empty
   *  string key corresponds to cwd itself. */
  gitAggregate: Map<string, GitFileStatus>;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const cm = useContextMenu();
  const open = expandedPaths.has(node.fullPath);
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [flashHighlight, setFlashHighlight] = useState(false);
  // Inline "new file / new folder" input shown as the first child of a
  // directory when triggered from its context menu.
  const [creating, setCreating] = useState<ExplorerCreateKind | null>(null);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Resolve this node's git status. File lookups hit `gitFilesByPath`
  // (O(1)); folder lookups hit `gitAggregate` (O(1)). Either can be
  // missing if the file/dir isn't part of any change set.
  const relPath = getRelativeFilePath(node.fullPath, cwd);
  const gitFile = !node.isDir ? gitFilesByPath.get(relPath) : undefined;
  const gitStatus: GitFileStatus | undefined = node.isDir
    ? gitAggregate.get(relPath)
    : gitFile?.status;
  const gitTooltip = gitStatus
    ? (node.isDir
        ? folderTooltip(gitStatus, t)
        : gitFile
          ? fileTooltip(gitFile, t)
          : folderTooltip(gitStatus, t))
    : undefined;

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    try {
      const entries = await fetchEntries(node.fullPath);
      setChildren(entries);
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath]);

  // Re-fetch children when refreshKey changes and the directory is already open/loaded
  useEffect(() => {
    if (open && loaded) {
      loadChildren(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleClick = useCallback(() => {
    if (renaming) return;
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded) loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, open, loadChildren, onOpenFile, onToggleExpanded, renaming]);

  // ---- context menu ----
  const copyText = useCallback(async (text: string) => {
    try {
      await copyToClipboard(text);
    } catch {
      // Both the Clipboard API and the execCommand fallback failed.
    }
    toast.show({ kind: "success", message: t("Copied") });
  }, [toast, t]);

  const onDelete = useCallback(async () => {
    const ok = await confirm({
      title: node.isDir ? t("Delete folder?") : t("Delete file?"),
      description: node.isDir
        ? `${node.name}\n${t("This folder and all its contents will be permanently deleted")}`
        : node.name,
      confirmLabel: t("Delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      const url = node.isDir
        ? `/api/files/${encodeFilePathForApi(node.fullPath)}?recursive=true`
        : `/api/files/${encodeFilePathForApi(node.fullPath)}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        toast.show({ kind: "error", message: error || t("Delete failed") });
        return;
      }
      toast.show({ kind: "success", message: t("Deleted") });
      onFileDeleted?.(node.fullPath);
      onFileMutated?.();
    } catch {
      toast.show({ kind: "error", message: t("Network error") });
    }
  }, [node, confirm, t, toast, onFileDeleted, onFileMutated]);

  // ---- new file / folder / upload (directory context menu) ----
  const startCreate = useCallback((kind: ExplorerCreateKind) => {
    onToggleExpanded(node.fullPath, true);
    if (!loaded) void loadChildren();
    setCreateName("");
    setCreateError(null);
    setCreating(kind);
  }, [node.fullPath, onToggleExpanded, loaded, loadChildren]);

  const submitCreate = useCallback(async () => {
    if (!creating) return;
    const v = validateFileName(createName);
    if (!v.ok) {
      setCreateError(v.message);
      return;
    }
    if (children.some((c) => c.name === v.name)) {
      setCreateError(t("Name already exists"));
      return;
    }
    const res = await createEntry(node.fullPath, creating, v.name);
    if (!res.ok) {
      setCreateError(res.error || t("Create failed"));
      return;
    }
    toast.show({ kind: "success", message: creating === "folder" ? t("Folder created") : t("File created") });
    setCreating(null);
    setCreateError(null);
    await loadChildren(true);
    onFileMutated?.();
  }, [creating, createName, children, node.fullPath, t, toast, loadChildren, onFileMutated]);

  const handleUpload = useCallback(async (directory: boolean) => {
    if (uploading) return;
    const files = await pickFiles({ directory });
    if (files.length === 0) return;
    setUploading(true);
    try {
      const res = await uploadFilesToDir(node.fullPath, files);
      if (res.uploaded > 0) {
        toast.show({
          kind: "success",
          message: res.skipped > 0
            ? t("Uploaded {n} file(s), skipped {m} existing", { n: res.uploaded, m: res.skipped })
            : t("Uploaded {n} file(s)", { n: res.uploaded }),
        });
      } else if (res.skipped > 0) {
        toast.show({ kind: "info", message: t("All files already exist") });
      }
      if (res.failed.length > 0) {
        toast.show({ kind: "error", message: t("Failed to upload {n} file(s)", { n: res.failed.length }) });
      }
      if (res.uploaded > 0) {
        await loadChildren(true);
        onFileMutated?.();
      }
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Network error") });
    } finally {
      setUploading(false);
    }
  }, [uploading, node.fullPath, toast, t, loadChildren, onFileMutated]);

  // Duplicate a file next to itself (files only).
  const onDuplicate = useCallback(async () => {
    const res = await duplicateEntry(node.fullPath);
    if (!res.ok) {
      toast.show({ kind: "error", message: res.error || t("Duplicate failed") });
      return;
    }
    toast.show({ kind: "success", message: t("Duplicated") });
    onFileMutated?.();
  }, [node.fullPath, toast, t, onFileMutated]);

  // Drop a dragged entry onto this directory row to move it here.
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!node.isDir) return;
    const source = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
    if (!source) return;
    const destDir = node.fullPath;
    if (source === destDir) return;
    // Refuse moving a directory into itself / its own subtree.
    if (destDir.startsWith(source + "/")) {
      toast.show({ kind: "error", message: t("Cannot move a folder into itself") });
      return;
    }
    // Already directly inside this directory — nothing to do.
    if (source.slice(0, source.lastIndexOf("/")) === destDir) return;
    const res = await moveEntry(source, destDir);
    if (!res.ok) {
      toast.show({ kind: "error", message: res.error || t("Move failed") });
      return;
    }
    toast.show({ kind: "success", message: t("Moved") });
    onFileMutated?.();
  }, [node, toast, t, onFileMutated]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rel = getRelativeFilePath(node.fullPath, cwd);
    const items: ContextMenuItem[] = [
      ...(node.isDir
        ? [
            { key: "new_file", label: t("New file"), onSelect: () => startCreate("file") },
            { key: "new_folder", label: t("New folder"), onSelect: () => startCreate("folder") },
            { key: "upload_files", label: t("Upload files"), onSelect: () => { void handleUpload(false); } },
            { key: "upload_folder", label: t("Upload folder"), onSelect: () => { void handleUpload(true); } },
          ]
        : []),
      {
        key: "open",
        label: t("Open"),
        onSelect: () => { if (!node.isDir) onOpenFile(node.fullPath, node.name); },
        disabled: node.isDir,
      },
      { key: "copy_abs", label: t("Copy absolute path"), onSelect: () => copyText(node.fullPath) },
      { key: "copy_rel", label: t("Copy relative path"), onSelect: () => copyText(rel) },
      { key: "download", label: t("Download"), onSelect: () => triggerDownload(node.fullPath, node.isDir ? `${node.name}.zip` : node.name) },
      ...(node.isDir
        ? []
        : [{ key: "duplicate", label: t("Duplicate"), onSelect: () => { void onDuplicate(); } }]),
      { key: "rename", label: t("Rename"), onSelect: () => { setRenameValue(node.name); setRenameError(null); setRenaming(true); } },
      { key: "delete", label: t("Delete"), destructive: true, onSelect: () => { onDelete(); } },
    ];
    cm.open({ x: e.clientX, y: e.clientY, items, triggerElement: e.currentTarget as HTMLElement });
  }, [node, cwd, t, copyText, onOpenFile, onDelete, cm, startCreate, handleUpload, onDuplicate]);

  // ---- rename submit ----
  const submitRename = useCallback(async () => {
    const v = validateFileName(renameValue);
    if (!v.ok) {
      setRenameError(v.message);
      return;
    }
    if (v.name === node.name) {
      setRenaming(false);
      setRenameError(null);
      return;
    }
    // Optimistic duplicate check against loaded siblings (best-effort; backend is authoritative)
    if (children.some((c) => c.name === v.name)) {
      setRenameError(t("Name already exists"));
      return;
    }
    try {
      const res = await fetch(`/api/files/${encodeFilePathForApi(node.fullPath)}?type=rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName: v.name }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        setRenameError(error || t("Rename failed"));
        return;
      }
      setRenaming(false);
      setRenameError(null);
      setFlashHighlight(true);
      setTimeout(() => setFlashHighlight(false), 1000);
      toast.show({ kind: "success", message: t("Renamed") });
      onFileMutated?.();
    } catch {
      setRenameError(t("Network error"));
    }
  }, [renameValue, node, children, t, toast, onFileMutated]);

  return (
    <div>
      <div
        draggable={!renaming}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(DRAG_MIME, node.fullPath);
          e.dataTransfer.setData("text/plain", node.fullPath);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          // Only internal drags count; stop bubbling so file rows don't
          // trigger the root (move-to-cwd) drop zone underneath.
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.stopPropagation();
          if (!node.isDir) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.stopPropagation();
          if (!node.isDir || !e.dataTransfer.types.includes(DRAG_MIME)) return;
          void handleDrop(e);
        }}
        onClick={renaming ? undefined : handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
          cursor: renaming ? "default" : "pointer",
          background: dragOver
            ? "var(--bg-selected)"
            : flashHighlight
              ? "var(--bg-selected)"
              : hovered
                ? "var(--bg-hover)"
                : "transparent",
          outline: dragOver ? "1px dashed var(--accent)" : "none",
          outlineOffset: -1,
          borderRadius: 4,
          userSelect: "none",
          transition: "background 0.3s",
        }}
      >
        {node.isDir && (
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {node.isDir ? <FolderIcon size={14} open={open} name={node.name} /> : getFileIcon(node.name, 14)}
        </span>
        {renaming ? (
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => { setRenameValue(e.target.value); setRenameError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenaming(false);
                  setRenameError(null);
                }
              }}
              onBlur={() => {
                // If user hasn't submitted and value matches, cancel silently.
                if (renameValue === node.name) {
                  setRenaming(false);
                  setRenameError(null);
                }
                // Otherwise leave the input open with error if any; the user
                // can press Enter or click back into it.
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontSize: 12,
                padding: "1px 4px",
                border: "1px solid " + (renameError ? "#f87171" : "var(--accent)"),
                borderRadius: 3,
                background: "var(--bg)",
                color: "var(--text)",
                width: "100%",
              }}
            />
            {renameError && (
              <span style={{ fontSize: 10, color: "#f87171" }}>{renameError}</span>
            )}
          </span>
        ) : (
          <Tooltip content={
            gitTooltip
              ? <div>
                  <div style={{ opacity: 0.7 }}>{node.fullPath}</div>
                  <div>{gitTooltip}</div>
                </div>
              : node.fullPath
          }>
            <span
              style={{
                fontSize: 12,
                color: gitStatus ? gitStatusColor(gitStatus) : "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}
            >
              {node.name}
            </span>
          </Tooltip>
        )}
        {gitStatus && <FileGitBadge status={gitStatus} />}
        {loading && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
          </svg>
        )}
        {onAtMention && hovered && !renaming && (
          <Tooltip content={t("Insert path into chat")}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAtMention(node.fullPath);
            }}
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 8px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
            </svg>
            {t("mention")}
          </button>
          </Tooltip>
        )}
      </div>
      {node.isDir && open && (
        <div>
          {creating && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 4, paddingLeft: 8 + (depth + 1) * 14, paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}>
              <span style={{ flexShrink: 0, display: "flex", alignItems: "center", height: 20 }}>
                {creating === "folder"
                  ? <FolderIcon size={14} name={createName} />
                  : getFileIcon(createName || "file", 14)}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <input
                  autoFocus
                  value={createName}
                  placeholder={t("Name")}
                  onChange={(e) => { setCreateName(e.target.value); setCreateError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submitCreate();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setCreating(null);
                      setCreateError(null);
                    }
                  }}
                  onBlur={() => {
                    if (createName.trim() === "") {
                      setCreating(null);
                      setCreateError(null);
                    } else {
                      void submitCreate();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontSize: 12,
                    padding: "1px 4px",
                    border: "1px solid " + (createError ? "#f87171" : "var(--accent)"),
                    borderRadius: 3,
                    background: "var(--bg)",
                    color: "var(--text)",
                    width: "100%",
                  }}
                />
                {createError && (
                  <span style={{ fontSize: 10, color: "#f87171", whiteSpace: "normal" }}>{createError}</span>
                )}
              </span>
            </div>
          )}
          {children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
              refreshKey={refreshKey}
              onFileMutated={onFileMutated}
              onFileDeleted={onFileDeleted}
              gitFilesByPath={gitFilesByPath}
              gitAggregate={gitAggregate}
            />
          ))}
          {children.length === 0 && loaded && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: 11, color: "var(--text-dim)", height: 22, display: "flex", alignItems: "center" }}>
              {t("empty")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FileExplorer({ cwd, onOpenFile, refreshKey, onAtMention, onFileMutated, onFileDeleted, collapseKey, onExpandedCountChange }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [rootDragOver, setRootDragOver] = useState(false);
  const prevCwdRef = useRef<string | null>(null);

  // Drop on empty space → move the dragged entry to the cwd root.
  const handleRootDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setRootDragOver(false);
    const source = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
    if (!source || source === cwd) return;
    if (source.slice(0, source.lastIndexOf("/")) === cwd) return;
    const res = await moveEntry(source, cwd);
    if (!res.ok) {
      toast.show({ kind: "error", message: res.error || t("Move failed") });
      return;
    }
    toast.show({ kind: "success", message: t("Moved") });
    onFileMutated?.();
  }, [cwd, toast, t, onFileMutated]);

  // External "collapse all" trigger: a parent bumps `collapseKey` to ask us
  // to clear every expanded folder. We intentionally do NOT re-fetch — the
  // data is already loaded, the user just wants the tree folded back to its
  // roots. Initial value (or undefined) is ignored; only subsequent bumps
  // fire. A dedicated ref tracks the last seen value so the first effect run
  // (initial mount) is a no-op.
  const prevCollapseKeyRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (collapseKey === undefined) return;
    if (prevCollapseKeyRef.current !== undefined && prevCollapseKeyRef.current !== collapseKey) {
      setExpandedPaths(new Set());
    }
    prevCollapseKeyRef.current = collapseKey;
  }, [collapseKey]);

  // Subscribe to the git status store. Re-renders when entriesByCwd /
  // generationByCwd change for *any* cwd; the useMemo below filters to
  // the active cwd so we only recompute on real changes. `gitFiles` is
  // always a fresh array reference on every fetch (NextResponse.json
  // round-trips through JSON), so the useMemo dep alone is enough.
  const gitStore = useGitStatusStore();
  const gitEntry = gitStore.entriesByCwd.get(cwd);
  const gitFiles: GitDiffFile[] = gitEntry?.files ?? EMPTY_GIT_FILES;

  const gitFilesByPath = useMemo(() => {
    if (gitFiles === EMPTY_GIT_FILES) return EMPTY_GIT_FILES_BY_PATH;
    const m = new Map<string, GitDiffFile>();
    for (const f of gitFiles) m.set(f.path, f);
    return m;
  }, [gitFiles]);

  const gitAggregate = useMemo(
    () => (gitFiles === EMPTY_GIT_FILES ? EMPTY_GIT_AGGREGATE : aggregateFolderStatuses(gitFiles)),
    [gitFiles],
  );

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  // Polling lifecycle. Mount → start tracking cwd; unmount or cwd
  // change → stop. The store keeps entries cached across session
  // switches, so re-entering a previously-seen cwd paints badges
  // immediately on the next render.
  useEffect(() => {
    startTracking(cwd);
    return () => stopTracking();
  }, [cwd]);

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    // Reset expanded state only when cwd changes, not on refreshKey bumps
    if (cwdChanged) {
      setExpandedPaths(new Set());
    }

    setLoading(cwdChanged);
    setError(null);
    fetchEntries(cwd)
      .then((entries) => setRoots(entries))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [cwd, refreshKey]);

  // Report how many folders are expanded so the parent can disable its
  // "collapse all" button while this is 0 (nothing to fold back). Fires on
  // every expandedPaths change — manual toggles, cwd switches, and the
  // external collapseKey bump all flow through this one effect.
  useEffect(() => {
    onExpandedCountChange?.(expandedPaths.size);
  }, [expandedPaths, onExpandedCountChange]);

  if (loading) {
    return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
        {t("Loading files...")}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: "#f87171" }}>
        {error}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!rootDragOver) setRootDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setRootDragOver(false);
      }}
      onDrop={(e) => { void handleRootDrop(e); }}
      style={{
        minHeight: "100%",
        outline: rootDragOver ? "1px dashed var(--accent)" : "none",
        outlineOffset: -2,
        background: rootDragOver ? "var(--bg-hover)" : "transparent",
      }}
    >
      <div style={{ padding: "2px 4px" }}>
        {roots.map((node) => (
          <TreeNode
            key={node.fullPath}
            node={node}
            depth={0}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onAtMention={onAtMention}
            expandedPaths={expandedPaths}
            onToggleExpanded={handleToggleExpanded}
            refreshKey={refreshKey}
            onFileMutated={onFileMutated}
            onFileDeleted={onFileDeleted}
            gitFilesByPath={gitFilesByPath}
            gitAggregate={gitAggregate}
          />
        ))}
        {roots.length === 0 && (
          <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
            {t("No files found")}
          </div>
        )}
      </div>
    </div>
  );
}
