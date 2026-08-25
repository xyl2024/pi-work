"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { GitDiffFile, GitStatusResponse } from "@/lib/shared/git-diff-types";
import { GitDiffViewer } from "./GitDiffViewer";

interface Props {
  /** Session cwd (always a validated repo, checked by GitPanel). */
  cwd: string;
  /** Fresh repo status (files + per-file stats), owned by GitPanel. */
  status: GitStatusResponse;
}

export const GIT_STATUS_LABEL: Record<GitDiffFile["status"], string> = {
  "A": "A", "M": "M", "D": "D", "R": "R", "C": "C", "T": "T", "U": "U", "??": "?",
};

export const GIT_STATUS_COLOR: Record<GitDiffFile["status"], string> = {
  "A": "var(--git-status-added)",
  "M": "var(--git-status-modified)",
  "D": "var(--git-status-deleted)",
  "R": "var(--git-status-renamed)",
  "C": "var(--git-status-renamed)",
  "T": "var(--git-status-renamed)",
  "U": "var(--git-status-conflict)",
  "??": "var(--text-dim)",
};

/**
 * Worktree / staged change view: Staged↔Unstaged toggle + per-file list +
 * per-file unified diff. The parent GitPanel renders the shared states
 * (loading / not a repo / no session) and owns the status fetch; this
 * view only tracks selection and the loaded diff for the selected file.
 */
export function GitDiffView({ cwd, status }: Props) {
  const { t } = useI18n();

  const [staged, setStaged] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffTruncated, setDiffTruncated] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const viewRef = useRef<HTMLDivElement>(null);
  const [fileListHeight, setFileListHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const loadDiff = useCallback(async (path: string, stagedSide: boolean) => {
    setDiffLoading(true);
    setDiffError(null);
    try {
      const res = await fetch(
        `/api/git/diff?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(path)}&staged=${stagedSide ? "1" : "0"}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { diff: string | null; truncated: boolean };
      setDiffText(data.diff);
      setDiffTruncated(data.truncated);
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : String(e));
      setDiffText(null);
    } finally {
      setDiffLoading(false);
    }
  }, [cwd]);

  // When the selection, staged side, or the status object itself changes
  // (manual refresh in GitPanel), (re)load the diff for the selected file.
  // Re-fetching on status change keeps the pane honest after the agent
  // edits a file while it's still selected.
  useEffect(() => {
    if (!selectedPath) {
      setDiffText(null);
      setDiffError(null);
      return;
    }
    void loadDiff(selectedPath, staged);
  }, [selectedPath, staged, status, loadDiff]);

  const handleSelectFile = useCallback((f: GitDiffFile) => {
    // Default to the side that actually has changes for this file.
    if (f.status === "??") setStaged(false);
    else if (f.hasUnstaged && !f.hasStaged && staged) setStaged(false);
    else if (f.hasStaged && !f.hasUnstaged && !staged) setStaged(true);
    setSelectedPath(f.path);
  }, [staged]);

  // Files visible under the current staged/unstaged filter.
  // Untracked files (`??`) show only in the Unstaged view.
  const visibleFiles = useMemo(() => {
    return status.files.filter((f) =>
      staged ? f.hasStaged : (f.hasUnstaged || f.status === "??")
    );
  }, [status, staged]);

  // When the staged toggle changes, clear the selection if the current file
  // is no longer in the visible list (deleted from status, or moved to the
  // other side).
  useEffect(() => {
    if (selectedPath && !visibleFiles.some((f) => f.path === selectedPath)) {
      setSelectedPath(null);
    }
  }, [visibleFiles, selectedPath]);

  const selectedFile = visibleFiles.find((f) => f.path === selectedPath) ?? null;

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";

    const handlePointerMove = (event: PointerEvent) => {
      const view = viewRef.current;
      if (!view) return;
      const rect = view.getBoundingClientRect();
      const minListHeight = 80;
      const minDiffHeight = 80;
      const nextHeight = Math.min(
        Math.max(event.clientY - rect.top, minListHeight),
        Math.max(minListHeight, rect.height - minDiffHeight),
      );
      setFileListHeight(nextHeight);
    };
    const handlePointerUp = () => setIsResizing(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [isResizing]);

  if (status.files.length === 0) {
    return (
      <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
        {t("No changes")}
      </div>
    );
  }

  return (
    <div ref={viewRef} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Staged/Unstaged toggle */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "6px 10px",
        flexShrink: 0,
      }}>
        {([false, true] as const).map((side) => (
          <button
            key={side ? "staged" : "unstaged"}
            onClick={() => setStaged(side)}
            disabled={diffLoading}
            style={{
              padding: "3px 10px", fontSize: 11, borderRadius: 6,
              border: "1px solid var(--border)",
              background: staged === side ? "var(--bg-selected)" : "var(--bg)",
              color: staged === side ? "var(--text)" : "var(--text-muted)",
              cursor: diffLoading ? "not-allowed" : "pointer",
              fontWeight: staged === side ? 600 : 400,
            }}
          >
            {side ? t("Staged") : t("Unstaged")}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {t("{n} files changed", { n: visibleFiles.length })}
        </span>
      </div>

      {/* File list */}
      <div style={{
        flex: fileListHeight === null ? "0 0 40%" : `0 0 ${fileListHeight}px`,
        minHeight: 80, overflowY: fileListHeight === null ? "auto" : "auto", overflowX: "hidden",
      }}>
        {visibleFiles.length === 0 ? (
          <div style={{ padding: "20px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
            {staged ? t("No staged changes") : t("No unstaged changes")}
          </div>
        ) : (
          visibleFiles.map((f) => {
            const active = f.path === selectedPath;
            return (
              <button
                key={f.path}
                onClick={() => handleSelectFile(f)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "calc(100% - 12px)", boxSizing: "border-box", margin: "3px 6px", padding: "6px 10px",
                  background: active ? "var(--bg-selected)" : "transparent",
                  border: "none", borderRadius: 6,
                  color: "var(--text)", cursor: "pointer", textAlign: "left",
                  fontSize: 12, overflowWrap: "anywhere",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = active ? "var(--bg-selected)" : "transparent"; }}
              >
                <span style={{
                  width: 16, flexShrink: 0, textAlign: "center",
                  fontSize: 10, fontWeight: 700,
                  color: GIT_STATUS_COLOR[f.status],
                  border: `1px solid ${GIT_STATUS_COLOR[f.status]}`,
                  borderRadius: 3, padding: "0 1px",
                }}>
                  {GIT_STATUS_LABEL[f.status]}
                </span>
                <span style={{
                  flex: 1, minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word",
                  color: f.status === "??" ? "var(--text-muted)" : "var(--text)",
                }}>
                  {f.path}
                </span>
                <span style={{ flexShrink: 0, fontSize: 10, fontFamily: "var(--font-mono)" }}>
                  {f.additions > 0 && <span style={{ color: "#16a34a" }}>+{f.additions}</span>}
                  {f.additions > 0 && f.deletions > 0 && " "}
                  {f.deletions > 0 && <span style={{ color: "#ef4444" }}>-{f.deletions}</span>}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Resize handle + Diff view */}
      <div
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={handleResizeStart}
        style={{
          flex: "0 0 6px",
          cursor: "row-resize",
          background: "transparent",
          borderTop: "1px solid var(--border)",
          borderBottom: "none",
          touchAction: "none",
        }}
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "transparent" }}>
        {diffError ? (
          <div style={{ padding: "16px 12px", fontSize: 12, color: "#f87171" }}>{diffError}</div>
        ) : diffLoading ? (
          <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--text-dim)" }}>
            {t("Loading…")}
          </div>
        ) : !selectedFile ? (
          <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
            {t("Select a file to view its diff")}
          </div>
        ) : diffText === null ? (
          <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
            {t("No changes for this file")}
          </div>
        ) : (
          <GitDiffViewer diff={diffText} truncated={diffTruncated} />
        )}
      </div>
    </div>
  );
}