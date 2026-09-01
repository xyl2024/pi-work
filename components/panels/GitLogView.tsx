"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { relativeTime } from "../rss/relativeTime";
import type {
  GitCommitDetailResponse,
  GitCommitFile,
  GitLogCommit,
  GitLogPageResponse,
} from "@/lib/shared/git-log-types";
import { GitDiffViewer } from "./GitDiffViewer";
import { DatePicker } from "../ui/DatePicker";
import { GIT_STATUS_COLOR, GIT_STATUS_LABEL } from "./GitDiffView";

interface Props {
  /** Session cwd (always a validated repo — GitPanel gates before this). */
  cwd: string;
  /** Branch whose history to show; null = current HEAD. Owned by GitPanel. */
  branch: string | null;
  /** Bumped by GitPanel's refresh button; resets the list to page 1. */
  refreshToken: number;
  /** Only show commit details while the right panel is expanded. */
  showDetail: boolean;
  /** Expands the host panel when a commit is selected. */
  onCommitSelected?: () => void;
}

const PAGE_SIZE = 30;
/** Stop infinite-scroll loading past this many commits (per branch). */
const MAX_COMMITS = 500;

function formatDate(iso: string): string {
  const ts = new Date(iso).getTime();
  return Number.isNaN(ts) ? iso : relativeTime(ts, "");
}

/** Convert a unix-ms day to `YYYY-MM-DD` (local time) for git's
 *  `--since/--until`. The DatePicker operates at day granularity, and
 *  omitting any time component makes git treat the range end as inclusive. */
function toISODay(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function statusBadge(status: string): { label: string; color: string } {
  return {
    label: (GIT_STATUS_LABEL as Record<string, string>)[status] ?? status,
    color: (GIT_STATUS_COLOR as Record<string, string>)[status] ?? "var(--text-dim)",
  };
}

/**
 * Commit history view: branch-aware commit list (infinite scroll) on the
 * left, selected commit's details (message + author + file stats) and
 * per-file diff on the right. All state is local; GitPanel drives branch
 * selection and refresh via props.
 */
export function GitLogView({ cwd, branch, refreshToken, showDetail, onCommitSelected }: Props) {
  const { t } = useI18n();

  const [commits, setCommits] = useState<GitLogCommit[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<GitLogCommit | null>(null);
  const [detail, setDetail] = useState<GitCommitDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiffText, setFileDiffText] = useState<string | null>(null);
  const [fileDiffTruncated, setFileDiffTruncated] = useState(false);
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const [fileDiffError, setFileDiffError] = useState<string | null>(null);

  // Date-range filter (e.g. "show commits from May to June"). Each is the
  // selected day as unix-ms (DatePicker granularity) or null = unfiltered.
  // Changing either resets the list back to page 1.
  const [sinceTs, setSinceTs] = useState<number | null>(null);
  const [untilTs, setUntilTs] = useState<number | null>(null);
  const dateFilterDirty = sinceTs !== null || untilTs !== null;

  const detailColumnRef = useRef<HTMLDivElement>(null);
  const [detailHeight, setDetailHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const fetchPage = useCallback(async (skip: number, limit: number): Promise<GitLogPageResponse> => {
    const params = new URLSearchParams({ cwd });
    if (branch) params.set("branch", branch);
    if (sinceTs !== null) params.set("since", toISODay(sinceTs));
    if (untilTs !== null) params.set("until", toISODay(untilTs));
    params.set("skip", String(skip));
    params.set("limit", String(limit));
    const res = await fetch(`/api/git/log?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as GitLogPageResponse;
  }, [cwd, branch, sinceTs, untilTs]);

  const loadFirstPage = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const data = await fetchPage(0, PAGE_SIZE);
      setCommits(data.commits);
      setHasMore(data.hasMore);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  }, [fetchPage]);

  // Reset everything + load page 1 when cwd / branch / refresh / date
  // filter changes.
  useEffect(() => {
    setCommits([]);
    setHasMore(true);
    setListError(null);
    setSelected(null);
    setDetail(null);
    setSelectedFile(null);
    setFileDiffText(null);
    setDetailHeight(null);
    void loadFirstPage();
  }, [cwd, branch, refreshToken, sinceTs, untilTs, loadFirstPage]);

  // Infinite scroll: append the next page when the list nears the bottom.
  const loadMore = useCallback(async () => {
    if (!hasMore || listLoading || commits.length === 0) return;
    if (commits.length >= MAX_COMMITS) {
      setHasMore(false);
      return;
    }
    setListLoading(true);
    try {
      const data = await fetchPage(commits.length, PAGE_SIZE);
      setCommits((prev) => [...prev, ...data.commits]);
      setHasMore(data.hasMore);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  }, [hasMore, listLoading, commits.length, fetchPage]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) void loadMore();
  }, [loadMore]);

  // Load commit detail when a commit is selected.
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/git/commit?cwd=${encodeURIComponent(cwd)}&commit=${encodeURIComponent(selected.fullHash)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GitCommitDetailResponse;
        if (cancelled) return;
        if (!data.commit) {
          setDetail(null);
          setDetailError(t("Commit not found"));
          return;
        }
        setDetail(data);
      } catch (e) {
        if (!cancelled) setDetailError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, cwd, t]);

  const handleSelectCommit = useCallback((c: GitLogCommit) => {
    setSelectedFile(null);
    setFileDiffText(null);
    setDetailHeight(null);
    setSelected(c);
    onCommitSelected?.();
  }, [onCommitSelected]);

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
      const container = detailColumnRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const minHeight = 100;
      const minDiffHeight = 80;
      const nextHeight = Math.min(
        Math.max(event.clientY - rect.top, minHeight),
        Math.max(minHeight, rect.height - minDiffHeight),
      );
      setDetailHeight(nextHeight);
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

  // Load the file diff (inside the selected commit) when a file is picked.
  useEffect(() => {
    if (!selected || !selectedFile) {
      setFileDiffText(null);
      setFileDiffError(null);
      return;
    }
    let cancelled = false;
    setFileDiffLoading(true);
    setFileDiffError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/git/diff?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(selectedFile)}&commit=${encodeURIComponent(selected.fullHash)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { diff: string | null; truncated: boolean };
        if (cancelled) return;
        setFileDiffText(data.diff);
        setFileDiffTruncated(data.truncated);
      } catch (e) {
        if (!cancelled) setFileDiffError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setFileDiffLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, selectedFile, cwd]);

  const handleReset = useCallback(() => {
    let changed = false;
    if (sinceTs !== null) { setSinceTs(null); changed = true; }
    if (untilTs !== null) { setUntilTs(null); changed = true; }
    if (changed) {
      setSelected(null);
      setDetail(null);
      setSelectedFile(null);
      setFileDiffText(null);
      setDetailHeight(null);
    }
  }, [sinceTs, untilTs]);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* Commit list */}
      <div
        onScroll={handleScroll}
        style={{
          flex: showDetail ? "0 0 42%" : "1 1 100%", minWidth: 140, height: "100%",
          overflowY: "auto", overflowX: "hidden", borderRight: "1px solid var(--border)",
          background: "transparent",
        }}
      >
        {/* Date-range filter bar (sticky so it stays visible while scrolling) */}
        <div style={{
          position: "sticky", top: 0, zIndex: 2,
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px 8px",
          borderBottom: dateFilterDirty ? "1px solid var(--border)" : "1px solid transparent",
          background: "transparent",
        }}>
          <DatePicker
            value={sinceTs}
            onChange={setSinceTs}
            max={untilTs ?? undefined}
            placeholder={t("From")}
            ariaLabel={t("From date")}
            align="end"
          />
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>–</span>
          <DatePicker
            value={untilTs}
            onChange={setUntilTs}
            min={sinceTs ?? undefined}
            placeholder={t("To")}
            ariaLabel={t("To date")}
            align="end"
          />
          {dateFilterDirty && (
            <button
              onClick={handleReset}
              title={t("Show all")}
              style={{
                padding: "2px 7px", fontSize: 11,
                background: "var(--bg)", color: "var(--text-muted)",
                border: "1px solid var(--border)", borderRadius: 5,
                cursor: "pointer", flexShrink: 0,
                fontFamily: "inherit",
              }}
            >
              ✕
            </button>
          )}
        </div>
        {listError ? (
          <div style={{ padding: "16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{listError}</div>
            <button
              onClick={() => void loadFirstPage()}
              style={{ padding: "4px 12px", fontSize: 12, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}
            >
              {t("Retry")}
            </button>
          </div>
        ) : commits.length === 0 && !listLoading ? (
          <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
            {dateFilterDirty ? t("No commits in this date range") : t("No commits on this branch")}
          </div>
        ) : (
          commits.map((c) => {
            const active = selected?.fullHash === c.fullHash;
            return (
              <button
                key={c.fullHash}
                onClick={() => handleSelectCommit(c)}
                style={{
                  display: "flex", flexDirection: "column", gap: 2,
                  width: "calc(100% - 12px)", boxSizing: "border-box", margin: "3px 6px", padding: "7px 10px",
                  background: active ? "var(--bg-selected)" : "transparent",
                  border: "none", borderRadius: 6,
                  color: "var(--text)", cursor: "pointer", textAlign: "left",
                  fontSize: 12, overflowWrap: "anywhere",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = active ? "var(--bg-selected)" : "transparent"; }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>{c.shortHash}</span>
                  <span style={{ flex: 1, minWidth: 0, color: "var(--text)", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    {c.subject}
                  </span>
                </span>
                <span style={{ fontSize: 10, color: "var(--text-dim)", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  {c.authorName} · {formatDate(c.authorDate)}
                </span>
              </button>
            );
          })
        )}
        {listLoading && commits.length > 0 && (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
            {t("Loading…")}
          </div>
        )}
        {!listLoading && !listError && commits.length > 0 && !hasMore && commits.length >= MAX_COMMITS && (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
            {t("Reached the limit")}
          </div>
        )}
      </div>

      {/* Detail + diff */}
      {showDetail && <div ref={detailColumnRef} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%", background: "transparent" }}>
        {!selected ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 12px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
            {t("Select a commit to view its details")}
          </div>
        ) : (
          <>
            {/* Detail
              By default (before the user drags the handle) the section is
              content-sized, but capped at half the pane — otherwise a commit
              with many files would push the diff view out of the visible
              area. Larger lists scroll inside the capped section. */}
            <div style={{
              flex: detailHeight === null ? "0 0 auto" : `0 0 ${detailHeight}px`,
              minHeight: 100,
              maxHeight: detailHeight === null ? "50%" : undefined,
              overflowY: "auto",
              borderBottom: "1px solid var(--border)",
            }}>
              {detailLoading ? (
                <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--text-dim)" }}>{t("Loading…")}</div>
              ) : detailError ? (
                <div style={{ padding: "16px 12px", fontSize: 12, color: "#f87171" }}>{detailError}</div>
              ) : !detail ? null : (
                <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>{detail.commit.fullHash}</span>
                    {detail.commit.isMerge && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", border: "1px solid #3b82f6", borderRadius: 3, padding: "0 4px" }}>
                        {t("Merge commit")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>
                    {detail.commit.subject}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {detail.commit.authorName} &lt;{detail.commit.authorEmail}&gt; · {formatDate(detail.commit.authorDate)}
                  </div>
                  {detail.body && (
                    <div style={{
                      fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5,
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                      borderTop: "1px solid var(--border)", paddingTop: 6,
                    }}>
                      {detail.body}
                    </div>
                  )}
                  {detail.commit.isMerge ? (
                    <div style={{ marginTop: 6, padding: "6px 10px", fontSize: 11, background: "rgba(59,130,246,0.1)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 6 }}>
                      {t("Merge commit")} — {t("Per-file stats are unavailable for merge commits")}
                    </div>
                  ) : (
                    <>
                      <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
                        {t("Files changed")} ({detail.files.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        {detail.files.length === 0 ? (
                          <div style={{ padding: "8px 0", fontSize: 11, color: "var(--text-dim)" }}>
                            {t("No file changes in this commit")}
                          </div>
                        ) : (
                          detail.files.map((f: GitCommitFile) => {
                            const active = f.path === selectedFile;
                            const badge = statusBadge(f.status);
                            return (
                              <button
                                key={f.path}
                                onClick={() => setSelectedFile(f.path)}
                                style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  width: "100%", padding: "4px 6px",
                                  background: active ? "var(--bg-selected)" : "transparent",
                                  border: "none", borderRadius: 4,
                                  cursor: "pointer", textAlign: "left", fontSize: 11.5,
                                  color: "var(--text)",
                                }}
                                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--bg-hover)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = active ? "var(--bg-selected)" : "transparent"; }}
                              >
                                <span style={{ width: 16, flexShrink: 0, textAlign: "center", fontSize: 10, fontWeight: 700, color: badge.color, border: `1px solid ${badge.color}`, borderRadius: 3, padding: "0 1px" }}>
                                  {badge.label}
                                </span>
                                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Resize handle + file diff for the selected commit file */}
            <div
              role="separator"
              aria-orientation="horizontal"
              onPointerDown={handleResizeStart}
              style={{
                flex: "0 0 6px",
                cursor: "row-resize",
                background: "transparent",
                borderBottom: "none",
                touchAction: "none",
              }}
            />
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "transparent" }}>
              {fileDiffError ? (
                <div style={{ padding: "16px 12px", fontSize: 12, color: "#f87171" }}>{fileDiffError}</div>
              ) : fileDiffLoading ? (
                <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--text-dim)" }}>{t("Loading…")}</div>
              ) : !selectedFile ? (
                <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
                  {t("Select a file to view its diff")}
                </div>
              ) : fileDiffText === null ? (
                <div style={{ padding: "24px 12px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
                  {t("No changes for this file")}
                </div>
              ) : (
                <GitDiffViewer diff={fileDiffText} truncated={fileDiffTruncated} />
              )}
            </div>
          </>
        )}
      </div>}
    </div>
  );
}