"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { decideLoadMoreOnScroll } from "@/lib/shared/sidebar-paging";
import { sessionDisplayTitle } from "@/lib/shared/session-title";
import type { SessionInfo, SessionSearchPagedResult } from "@/lib/shared/types";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 220;
const LOAD_MORE_THRESHOLD_PX = 24;

interface Props {
  cwd: string;
  onClose: () => void;
  onSelectSession: (session: SessionInfo) => void;
}

interface PageState {
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  rows: SessionSearchPagedResult[];
  nextCursor: string | null;
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

function highlightSnippet(snippet: string): React.ReactNode[] {
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

export function CwdSessionsModal({ cwd, onClose, onSelectSession }: Props) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({
    isOpen: true,
    onClose,
    backdropAlpha: 0.45,
  });

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState<PageState>(INITIAL_PAGE);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    const id = setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useBodyScrollLock(true);

  const fetchPage = useCallback(
    async (cursor: string | null, mode: "reset" | "append") => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPage((prev) => ({
        ...prev,
        loading: mode === "reset",
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

  useEffect(() => {
    void fetchPage(null, "reset");
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });
  }, [debouncedQuery, cwd, fetchPage]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const shouldLoad = decideLoadMoreOnScroll({
      metrics: {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
      },
      thresholdPx: LOAD_MORE_THRESHOLD_PX,
      hasMore: page.nextCursor !== null,
      loading: page.loading || page.loadingMore,
      rowCount: page.rows.length,
    });
    if (shouldLoad && page.nextCursor) {
      void fetchPage(page.nextCursor, "append");
    }
  }, [page.nextCursor, page.loading, page.loadingMore, page.rows.length, fetchPage]);

  const handleRowClick = useCallback((row: SessionSearchPagedResult) => {
    onSelectSession(row);
    onClose();
  }, [onSelectSession, onClose]);

  const handleRetry = useCallback(() => {
    void fetchPage(null, "reset");
  }, [fetchPage]);

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
          {sessionDisplayTitle(row)}
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
