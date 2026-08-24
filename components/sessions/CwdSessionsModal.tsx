"use client";

/**
 * CwdSessionsModal — sidebar "View more sessions" modal.
 *
 * Opened from the "..." menu on each cwd group header in the multi-cwd
 * sidebar. Lets the user browse the full session list for that cwd:
 *
 *   - infinite-scroll (default 20 rows per fetch, same cursor-based
 *     pagination as the sidebar's normal /api/sessions route). The next
 *     page is requested automatically when the list scrolls within
 *     LOAD_MORE_THRESHOLD_PX of the bottom — no "Next page" button.
 *   - searchable by either session name OR user/assistant message content
 *     (the server's `q` parameter maps to searchSessionsPaged, which
 *     walks every JSONL in the cwd's workspace dir and returns the
 *     matching rows with matchCount / snippet / matchLocation)
 *
 * Click any row to switch to that session — the modal closes and the
 * sidebar updates the active selection through the same onSelectSession
 * contract the rest of the sidebar uses.
 *
 * Close: Esc, backdrop click, top-right × button, or picking a session.
 * Body scroll is locked while the modal is open so the page behind
 * doesn't scroll.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import type { SessionInfo, SessionSearchPagedResult } from "@/lib/shared/types";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 220;
/** Trigger the next-page fetch when the bottom of the list is within
 *  this many pixels of the viewport. Matches GitLogView's threshold so
 *  the two infinite-scroll lists feel the same. */
const LOAD_MORE_THRESHOLD_PX = 24;

interface Props {
  /** Absolute path of the cwd whose sessions to browse. */
  cwd: string;
  onClose: () => void;
  onSelectSession: (session: SessionInfo) => void;
}

interface PageState {
  /** True only for the very first fetch of the current query — prevents
   *  the empty state from flashing in while the request is in flight. */
  loading: boolean;
  /** True while a follow-up page (infinite-scroll triggered) is in
   *  flight. Lets the bottom-of-list sentinel show a spinner without
   *  wiping out the rows we already have. */
  loadingMore: boolean;
  error: string | null;
  rows: SessionSearchPagedResult[];
  /** Opaque cursor produced by /api/sessions for the next page. */
  nextCursor: string | null;
  /** Total matches across all pages (only populated when a query is set). */
  total: number | null;
}

const INITIAL_PAGE: PageState = {
  loading: false,
  loadingMore: false,
  error: null,
  rows: [],
  nextCursor: null,
  total: null,
};

// ── Helpers ───────────────────────────────────────────────────────────

function highlightSnippet(snippet: string): React.ReactNode[] {
  // The server uses \u0000 (NUL) markers to delimit the matched substring
  // — see buildSnippet() in lib/session-reader.ts. Anything between two
  // NULs gets wrapped in <mark>.
  const parts: React.ReactNode[] = [];
  let remaining = snippet;
  let key = 0;
  while (remaining.length > 0) {
    const markerIdx = remaining.indexOf("");
    if (markerIdx === -1) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (markerIdx > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, markerIdx)}</span>);
    }
    remaining = remaining.slice(markerIdx + 1);
    const endIdx = remaining.indexOf("");
    if (endIdx === -1) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
    parts.push(<mark key={key++} className="session-search-highlight">{remaining.slice(0, endIdx)}</mark>);
    remaining = remaining.slice(endIdx + 1);
  }
  return parts;
}

function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function basenameOf(cwd: string): string {
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const parts = cwd.split(sep).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

// ── Component ─────────────────────────────────────────────────────────

export function CwdSessionsModal({ cwd, onClose, onSelectSession }: Props) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({
    isOpen: true,
    onClose,
    backdropAlpha: 0.45,
  });

  const [query, setQuery] = useState("");
  // Stash the debounced query so the fetch effect always reads the
  // settled value, not whatever the input was during a keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState<PageState>(INITIAL_PAGE);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Ref to the scrolling element so we can restore scrollTop after a
  // query reset (we want the new result list to start at the top, not
  // wherever the old list happened to leave the thumb).
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Debounce the input → debouncedQuery. The fetch effect reads
  // debouncedQuery, so a fast typer doesn't fire one request per
  // keystroke.
  useEffect(() => {
    const trimmed = query.trim();
    const id = setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Focus the search input on open (matches the Cmd+K palette).
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Body scroll lock while the modal is open. The parent uses the
  // conditional-mount pattern (renders <CwdSessionsModal> only while
  // open), so the hook is active for the entire lifetime.
  useBodyScrollLock(true);

  // Fetch a page. `cursor` is what we send on the wire. `mode`:
  //   - "reset"    → first page of the current query; wipe rows.
  //   - "append"   → infinite-scroll continuation; keep rows, append.
  const fetchPage = useCallback(
    async (cursor: string | null, mode: "reset" | "append") => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPage((prev) => ({
        ...prev,
        loading: mode === "reset",
        // Only flip the follow-up spinner on for "append" — on reset the
        // primary loading: true is what we want users to see.
        loadingMore: mode === "append",
        error: null,
        rows: mode === "reset" ? [] : prev.rows,
      }));

      try {
        const params = new URLSearchParams();
        params.set("cwd", cwd);
        params.set("limit", String(PAGE_SIZE));
        if (cursor) params.set("cursor", cursor);
        if (debouncedQuery) params.set("q", debouncedQuery);

        const res = await fetch(`/api/sessions?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          sessions: SessionSearchPagedResult[];
          nextCursor: string | null;
          total?: number;
        };
        if (controller.signal.aborted) return;

        setPage((prev) => {
          if (mode === "reset") {
            return {
              loading: false,
              loadingMore: false,
              error: null,
              rows: data.sessions,
              nextCursor: data.nextCursor ?? null,
              total: data.total ?? null,
            };
          }
          // Append — dedupe by id so an out-of-order retry doesn't
          // produce duplicates if the user scrolled back near the
          // boundary mid-fetch.
          const seen = new Set(prev.rows.map((r) => r.id));
          const incoming = data.sessions.filter((r) => !seen.has(r.id));
          return {
            loading: false,
            loadingMore: false,
            error: null,
            rows: incoming.length === 0 ? prev.rows : [...prev.rows, ...incoming],
            nextCursor: data.nextCursor ?? null,
            total: data.total ?? null,
          };
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        setPage((prev) => ({
          ...prev,
          loading: false,
          loadingMore: false,
          error: msg,
        }));
      }
    },
    [cwd, debouncedQuery],
  );

  // Re-fetch when the debounced query OR cwd changes. Snaps the list
  // back to the top so the user always sees page 1 of their new query.
  useEffect(() => {
    void fetchPage(null, "reset");
    // Reset the scroll container after the new rows render — requestAnimationFrame
    // waits for the DOM to settle without us having to thread refs into the
    // setPage callback.
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });
  }, [debouncedQuery, cwd, fetchPage]);

  // Cleanup on unmount: abort any in-flight request.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Infinite-scroll trigger: fetch the next page when the scroll
  // container is within LOAD_MORE_THRESHOLD_PX of the bottom. Guarded
  // against the initial render (no rows yet) and the already-loading
  // case so a fast scroller can't pile up requests.
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!page.nextCursor) return;
    if (page.loading || page.loadingMore) return;
    if (page.rows.length === 0) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_THRESHOLD_PX) {
      void fetchPage(page.nextCursor, "append");
    }
  }, [page.nextCursor, page.loading, page.loadingMore, page.rows.length, fetchPage]);

  const handleRowClick = useCallback((row: SessionSearchPagedResult) => {
    // Forward as SessionInfo — the parent (sidebar) only consumes the
    // standard fields. matchCount/snippet/matchLocation are stripped
    // before the call goes out.
    onSelectSession(row);
    onClose();
  }, [onSelectSession, onClose]);

  const handleRetry = useCallback(() => {
    // Retry from the top of the current query — same as a fresh load.
    void fetchPage(null, "reset");
  }, [fetchPage]);

  // Footer count label. Without a query, server doesn't return `total`
  // — we just show "Showing N" (or "Showing N+" if there's more).
  const totalLabel = page.total === null
    ? (page.nextCursor ? `${page.rows.length}+` : `${page.rows.length}`)
    : `${page.rows.length} / ${page.total}`;

  const inputPlaceholder = debouncedQuery
    ? t("Search sessions...")
    : t("Search by name or content...");

  if (!isVisible) return null;

  const isEmpty = !page.loading && page.rows.length === 0 && !page.error;

  return createPortal(
    <div
      style={backdropStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        style={{
          ...panelStyle,
          position: "relative",
          width: 760,
          maxWidth: "92vw",
          height: "78vh",
          maxHeight: 720,
          background: "var(--bg)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 10px 36px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text)",
              flexShrink: 0,
            }}
          >
            {t("View more sessions")}
          </h2>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={cwd}
          >
            {basenameOf(cwd)}
          </span>
          <button
            type="button"
            onClick={requestClose}
            aria-label={t("Close")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              padding: 0,
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                requestClose();
              }
            }}
            placeholder={inputPlaceholder}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "inherit",
              padding: 0,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("Clear")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                padding: 0,
                background: "transparent",
                border: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Result list — infinite scroll: handleScroll requests the next
            page when the bottom of this container comes within
            LOAD_MORE_THRESHOLD_PX of the viewport. */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "8px 12px",
          }}
        >
          {page.loading && page.rows.length === 0 && (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              {t("Loading sessions...")}
            </div>
          )}

          {page.error && (
            <div style={{ padding: "24px 16px", textAlign: "center", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
              <div style={{ color: "#f87171", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                {page.error}
              </div>
              <button
                type="button"
                onClick={handleRetry}
                style={{
                  padding: "4px 12px",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {t("Retry")}
              </button>
            </div>
          )}

          {isEmpty && (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              {debouncedQuery
                ? `${t("No sessions found matching")} \u201c${debouncedQuery}\u201d`
                : t("No sessions found")}
            </div>
          )}

          {page.rows.map((row) => (
            <SessionRow
              key={row.id}
              row={row}
              query={debouncedQuery}
              onClick={() => handleRowClick(row)}
            />
          ))}

          {/* Bottom sentinel: visible status of the infinite-scroll tail.
              Has three states — mid-fetch, end-of-list, or "scroll for
              more" hint when there are rows but more remain. */}
          {page.rows.length > 0 && page.loadingMore && (
            <div style={{ padding: "12px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
              {t("Loading...")}
            </div>
          )}
          {page.rows.length > 0 && !page.loadingMore && !page.nextCursor && (
            <div style={{ padding: "12px 16px", textAlign: "center", color: "var(--text-dim)", fontSize: 11 }}>
              {t("End of results")}
            </div>
          )}
        </div>

        {/* Footer: count only — pagination is now driven by scroll. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
            background: "var(--bg-subtle)",
          }}
        >
          <span style={{ flex: 1, fontSize: 11, color: "var(--text-dim)" }}>
            {debouncedQuery
              ? `${t("Matches")}: ${totalLabel}`
              : `${t("Showing")}: ${totalLabel}`}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Row ───────────────────────────────────────────────────────────────

function SessionRow({
  row,
  query,
  onClick,
}: {
  row: SessionSearchPagedResult;
  query: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const [hover, setHover] = useState(false);
  const showMatch = !!query;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 12px",
        borderRadius: 8,
        cursor: "pointer",
        background: hover ? "var(--bg-hover)" : "transparent",
        border: `1px solid ${hover ? "var(--border)" : "transparent"}`,
        marginBottom: 4,
        transition: "background 0.1s, border-color 0.1s",
      }}
    >
      {/* Line 1: name/firstMessage + meta */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.name || row.firstMessage || "(no name)"}
        </span>
        {row.running && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "1px 6px",
              borderRadius: 999,
              border: "1px solid var(--accent)",
              color: "var(--accent)",
            }}
          >
            {t("Running")}
          </span>
        )}
        <span
          style={{
            flexShrink: 0,
            fontSize: 11,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {relativeTime(row.modified)}
        </span>
      </div>

      {/* Line 2 (search mode): snippet with highlighted match */}
      {showMatch && row.snippet && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.45,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {row.matchLocation === "name" && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--accent)",
                marginRight: 6,
              }}
            >
              {t("Name")}
            </span>
          )}
          {highlightSnippet(row.snippet)}
        </div>
      )}

      {/* Line 2 (no search): first message preview */}
      {!showMatch && row.firstMessage && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.45,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.firstMessage}
        </div>
      )}

      {/* Match count (search mode only) */}
      {showMatch && row.matchCount > 1 && (
        <div
          style={{
            fontSize: 10,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {t("{n} matches").replace("{n}", String(row.matchCount))}
        </div>
      )}
    </div>
  );
}
