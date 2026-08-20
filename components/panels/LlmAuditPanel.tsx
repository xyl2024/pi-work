"use client";

/**
 * LLM API audit panel — per-call detail log of every actual HTTP request pi
 * made to an LLM provider (`~/.pi-work/llm-audit.db` → `provider_calls`).
 *
 * Unlike the Token audit panel (aggregate usage/cost), this shows the raw
 * request/response pair: URL, full request body, response status + headers,
 * and for failed calls the full error response body — the thing that tells
 * you *why* a model call stopped with no trace.
 *
 * List rows come from /api/llm-audit/calls; expanding a row fetches the full
 * record (bodies included) from /api/llm-audit/calls/[id].
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";
import { copyText } from "@/lib/client/clipboard";
import type { ProviderCall } from "@/lib/shared/llm-audit-types";

const PAGE_LIMIT = 10;

type StatusFilter = "" | "ok" | "error";

// ── formatters ────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusLabel(status: number | null): string {
  return status === null ? "—" : String(status);
}

/** Pretty-print JSON bodies; fall back to the raw string if not JSON. */
function formatBody(raw: string | null): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function parseHeaders(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
}

// ── main panel ────────────────────────────────────────────────────────────

interface LlmAuditPanelProps {
  /** The currently selected session id (null when on the new-session page). */
  currentSessionId: string | null;
}

export function LlmAuditPanel({ currentSessionId }: LlmAuditPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [filter, setFilter] = useState<StatusFilter>("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<ProviderCall[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProviderCall | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Auto-follow the current session; on the new-session page (null id) the
  // panel shows all sessions.
  const effectiveSessionId = currentSessionId;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_LIMIT),
        offset: String(offset),
      });
      if (filter) params.set("status", filter);
      if (effectiveSessionId) params.set("sessionId", effectiveSessionId);
      const res = await fetch(`/api/llm-audit/calls?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows: ProviderCall[]; total: number };
      setRows(data.rows);
      setTotal(data.total);
      if (offset > 0 && offset >= data.total) setOffset(0);
    } catch (e) {
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to load LLM API audit"),
      });
    } finally {
      setLoading(false);
    }
  }, [filter, offset, effectiveSessionId, toast, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset paging on filter or session change.
  useEffect(() => {
    setOffset(0);
  }, [filter, effectiveSessionId]);

  const toggleDetail = useCallback(
    async (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        setDetail(null);
        return;
      }
      setExpandedId(id);
      setDetailLoading(true);
      setDetail(null);
      try {
        const res = await fetch(`/api/llm-audit/calls/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ProviderCall;
        setDetail(data);
      } catch (e) {
        toast.show({
          kind: "error",
          message: e instanceof Error && e.message ? e.message : t("Failed to load LLM API audit"),
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [expandedId, toast, t],
  );

  const errorCount = useMemo(() => {
    if (!rows) return 0;
    return rows.filter((r) => r.status === null || r.status < 200 || r.status >= 300).length;
  }, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      <Toolbar filter={filter} onChangeFilter={setFilter} onRefresh={() => load()} />

      <div data-scroll-wide style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Pagination — at the top so the page controls stay adjacent to the
            controls (Toolbar) and the user can jump pages without scrolling. */}
        {total > PAGE_LIMIT && (
          <Pagination
            offset={offset}
            total={total}
            pageSize={PAGE_LIMIT}
            onChangeOffset={setOffset}
          />
        )}

        {/* KPI strip */}
        <div style={{ display: "flex", gap: 12 }}>
          <Kpi label={t("Total calls")} value={String(total)} accent={false} />
          <Kpi label={t("Errors")} value={String(errorCount)} accent={errorCount > 0} />
        </div>

        {loading && rows === null ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
            {t("Loading")}…
          </div>
        ) : !rows || rows.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
            {t("No LLM API calls recorded yet.")}
          </div>
        ) : (
          <CallList
            rows={rows}
            expandedId={expandedId}
            detail={detail}
            detailLoading={detailLoading}
            onToggle={toggleDetail}
          />
        )}
      </div>
    </div>
  );
}

// ── pagination ────────────────────────────────────────────────────────────

const pageBtnStyle = (active: boolean, disabled: boolean): CSSProperties => ({
  minWidth: 26,
  padding: "3px 6px",
  borderRadius: 6,
  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
  cursor: disabled ? "default" : "pointer",
  background: active ? "var(--accent)" : "transparent",
  color: active ? "#fff" : "var(--text-muted)",
  fontSize: 12,
  opacity: disabled ? 0.5 : 1,
  // Keep buttons at their natural content width. Without flexShrink: 0 the
  // flex algorithm squeezes them below `minWidth`, which forces CJK text
  // (e.g. "上一页") to wrap character-by-character. `whiteSpace: nowrap` is
  // a defensive belt-and-braces — if the container ever does overflow, the
  // text clips horizontally instead of breaking mid-character.
  whiteSpace: "nowrap",
  flexShrink: 0,
});

/** Page-number navigation with a jump-to-page input. */
function Pagination({
  offset,
  total,
  pageSize,
  onChangeOffset,
}: {
  offset: number;
  total: number;
  pageSize: number;
  onChangeOffset: (offset: number) => void;
}) {
  const { t } = useI18n();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;
  const [jumpValue, setJumpValue] = useState("");

  const goToPage = (p: number) => {
    const clamped = Math.min(Math.max(1, p), pageCount);
    onChangeOffset((clamped - 1) * pageSize);
  };

  // Window of page numbers: current ± 1, with first/last pinned. Most
  // navigation goes through the jump-to-page input, so the buttons are
  // just for stepping ±1 from the current page.
  const pages: number[] = [];
  const start = Math.max(1, currentPage - 1);
  const end = Math.min(pageCount, currentPage + 1);
  for (let p = start; p <= end; p++) pages.push(p);
  const showFirstEllipsis = start > 2;
  const showLastEllipsis = end < pageCount - 1;

  const onJumpSubmit = (e: FormEvent) => {
    e.preventDefault();
    const n = parseInt(jumpValue, 10);
    if (Number.isFinite(n)) {
      goToPage(n);
      setJumpValue("");
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
      <Tooltip content={t("Previous page")} side="top">
        <button disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)} style={pageBtnStyle(false, currentPage <= 1)} aria-label={t("Previous page")}>
          ‹
        </button>
      </Tooltip>

      {start > 1 && (
        <button onClick={() => goToPage(1)} style={pageBtnStyle(false, false)}>
          1
        </button>
      )}
      {showFirstEllipsis && <span>…</span>}

      {pages.map((p) => (
        <button key={p} onClick={() => goToPage(p)} style={pageBtnStyle(p === currentPage, false)}>
          {p}
        </button>
      ))}

      {showLastEllipsis && <span>…</span>}
      {end < pageCount && (
        <button onClick={() => goToPage(pageCount)} style={pageBtnStyle(false, false)}>
          {pageCount}
        </button>
      )}

      <Tooltip content={t("Next page")} side="top">
        <button disabled={currentPage >= pageCount} onClick={() => goToPage(currentPage + 1)} style={pageBtnStyle(false, currentPage >= pageCount)} aria-label={t("Next page")}>
          ›
        </button>
      </Tooltip>

      <span
        style={{
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {t("Showing {n} of {total}", {
          n: String(Math.min(offset + pageSize, total)),
          total: String(total),
        })}
      </span>

      <form onSubmit={onJumpSubmit} style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder={t("Page")}
          style={{
            width: 44,
            padding: "3px 6px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            color: "var(--text)",
            fontSize: 12,
          }}
        />
        <button type="submit" style={pageBtnStyle(false, false)}>
          Go
        </button>
      </form>
    </div>
  );
}

// ── toolbar ───────────────────────────────────────────────────────────────

function Toolbar({
  filter,
  onChangeFilter,
  onRefresh,
}: {
  filter: StatusFilter;
  onChangeFilter: (f: StatusFilter) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const options: Array<{ value: StatusFilter; label: string }> = [
    { value: "", label: t("All") },
    { value: "ok", label: t("Successful") },
    { value: "error", label: t("Failed") },
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", gap: 4 }}>
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChangeFilter(o.value)}
            style={{
              padding: "3px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid var(--border)",
              cursor: "pointer",
              background: filter === o.value ? "var(--accent)" : "transparent",
              color: filter === o.value ? "#fff" : "var(--text-muted)",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />
      <button
        onClick={onRefresh}
        style={{
          padding: "3px 10px",
          fontSize: 12,
          borderRadius: 6,
          border: "1px solid var(--border)",
          cursor: "pointer",
          background: "transparent",
          color: "var(--text-muted)",
        }}
      >
        {t("Refresh")}
      </button>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          fontFamily: "var(--font-mono)",
          color: accent ? "var(--danger, #e5484d)" : "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── call list ─────────────────────────────────────────────────────────────

function CallList({
  rows,
  expandedId,
  detail,
  detailLoading,
  onToggle,
}: {
  rows: ProviderCall[];
  expandedId: number | null;
  detail: ProviderCall | null;
  detailLoading: boolean;
  onToggle: (id: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((row) => {
        const isOpen = expandedId === row.id;
        return (
          <div
            key={row.id}
            style={{
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => onToggle(row.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                color: "var(--text)",
              }}
            >
              <span
                style={{
                  minWidth: 34,
                  padding: "2px 6px",
                  borderRadius: 5,
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  textAlign: "center",
                  color: "#fff",
                  background:
                    row.status === null ? "var(--danger, #e5484d)" : row.status >= 500 ? "var(--danger, #e5484d)" : row.status >= 400 ? "#b7791f" : "#2f9e44",
                }}
              >
                {statusLabel(row.status)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.provider ? `${row.provider}/${row.modelId ?? "?"}` : row.modelId ?? row.url}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fmtTime(row.ts)} · {row.attempt > 1 ? `${t("Call")} ${row.attempt} · ` : ""}
                  {fmtDuration(row.durationMs)}
                </div>
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{isOpen ? "▾" : "▸"}</span>
            </button>

            {isOpen && (
              <div data-scroll-wide style={{ borderTop: "1px solid var(--border)", padding: "12px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "60vh", overflowY: "auto" }}>
                {detailLoading ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("Loading")}…</div>
                ) : detail ? (
                  <DetailView row={detail} />
                ) : (
                  <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("Failed to load LLM API audit")}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── detail view ───────────────────────────────────────────────────────────

function DetailView({ row }: { row: ProviderCall }) {
  const { t } = useI18n();
  const requestHeaders = parseHeaders(row.requestHeaders);
  const responseHeaders = parseHeaders(row.responseHeaders);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
      {/* Meta row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
        <MetaTag label={`${t("Status")}: ${statusLabel(row.status)}`} />
        {row.provider && <MetaTag label={`${t("Provider")}: ${row.provider}`} />}
        {row.modelId && <MetaTag label={`${t("Model")}: ${row.modelId}`} />}
        {row.api && <MetaTag label={`API: ${row.api}`} />}
        {row.attempt > 1 && <MetaTag label={`${t("Call")}: ${row.attempt}`} />}
        <MetaTag label={`${t("Duration")}: ${fmtDuration(row.durationMs)}`} />
        {row.error && <MetaTag label={t("Network error")} danger />}
      </div>

      <Section title={`${t("Request URL")}`} body={row.url} mono />

      {row.error && (
        <div style={{ color: "var(--danger, #e5484d)", background: "rgba(229,72,77,0.08)", border: "1px solid rgba(229,72,77,0.3)", borderRadius: 8, padding: "8px 10px" }}>
          {row.error}
        </div>
      )}

      {requestHeaders && (
        <Section title={t("Request headers")} body={JSON.stringify(requestHeaders, null, 2)} mono />
      )}

      {row.requestBody && (
        <Section title={t("Request body")} body={formatBody(row.requestBody)} mono />
      )}

      {responseHeaders && (
        <Section title={t("Response headers")} body={JSON.stringify(responseHeaders, null, 2)} mono />
      )}

      {row.status !== null && row.status >= 200 && row.status < 300 ? (
        <div style={{ color: "var(--text-muted)" }}>{t("Response body is only captured for failed calls.")}</div>
      ) : row.responseBody ? (
        <Section title={t("Response body")} body={formatBody(row.responseBody)} mono />
      ) : row.status === null ? (
        <div style={{ color: "var(--text-muted)" }}>{t("This call failed before any response was received.")}</div>
      ) : null}
    </div>
  );
}

function MetaTag({ label, danger }: { label: string; danger?: boolean }) {
  return (
    <span
      style={{
        padding: "1px 7px",
        borderRadius: 5,
        border: "1px solid var(--border)",
        background: "var(--bg-subtle)",
        color: danger ? "var(--danger, #e5484d)" : "var(--text-muted)",
      }}
    >
      {label}
    </span>
  );
}

function Section({ title, body, mono }: { title: string; body: string; mono?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const handleCopy = async () => {
    try {
      await copyText(body);
      toast.show({ kind: "success", message: t("Copied") });
    } catch (e) {
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Copy failed"),
      });
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, flex: 1 }}>{title}</div>
        <Tooltip content={t("Copy")} side="top" align="end" delayDuration={200}>
          <button
            onClick={handleCopy}
            aria-label={t("Copy")}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "2px 5px",
              borderRadius: 5,
              border: "none",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {/* Two overlapping squares — standard copy glyph. */}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
              <path d="M8.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h1" />
            </svg>
          </button>
        </Tooltip>
      </div>
      <pre
        data-scroll-inset
        style={{
          margin: 0,
          padding: "8px 10px",
          borderRadius: 8,
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
          fontSize: 11,
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: "30vh",
          overflowY: "auto",
          color: "var(--text)",
        }}
      >
        {body}
      </pre>
    </div>
  );
}
