/**
 * TaskRunsTab — run history for one task.
 *
 * Card-style list (vs. the old cramped rows) that shows:
 *   - status pill (success / error / timeout / interrupted / running)
 *   - relative timestamp + duration
 *   - reply preview (expandable), or error message
 *   - "open session" link when a session id is attached
 *
 * Auto-refreshes every 2s while a run is in flight so the running badge
 * stays accurate without the user having to manually refresh.
 */

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { StatusBadge } from "./StatusBadge";
import { useNow } from "./useNow";
import { formatDuration, formatRelative } from "./utils";
import type { TaskRun } from "./types";
import { IconExternal } from "./icons";

export type RunFilter = "all" | "success" | "error" | "timeout" | "interrupted" | "running";

interface Props {
  runs: TaskRun[];
  loading: boolean;
  filter: RunFilter;
  onFilterChange: (f: RunFilter) => void;
  triggering: boolean;
  onTrigger: () => void;
  onOpenSession: (sessionId: string) => void;
}

const FILTERS: { id: RunFilter; label: string }[] = [
  { id: "all",     label: "All" },
  { id: "success", label: "Success" },
  { id: "error",   label: "Errors" },
  { id: "timeout", label: "Timeout" },
  { id: "interrupted", label: "Interrupted" },
  { id: "running", label: "Running" },
];

export function TaskRunsTab({
  runs, loading, filter, onFilterChange,
  triggering, onTrigger, onOpenSession,
}: Props) {
  const { t } = useI18n();
  const now = useNow(2_000);

  const filtered = useMemo(() => {
    if (filter === "all") return runs;
    return runs.filter((r) => r.status === filter);
  }, [runs, filter]);

  const inFlight = runs.some((r) => r.status === "running");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const count = countByStatus(runs, f.id);
            return (
              <button
                key={f.id}
                onClick={() => onFilterChange(f.id)}
                style={{
                  padding: "3px 9px",
                  fontSize: 11,
                  border: "1px solid",
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--bg-selected)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  borderRadius: 999,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {t(f.label)}
                {count > 0 && <span style={{ fontSize: 11, color: active ? "var(--accent)" : "var(--text-muted)" }}>{count}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            onClick={onTrigger}
            disabled={triggering}
            style={{
              padding: "4px 12px",
              fontSize: 11,
              fontWeight: 600,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: triggering ? "default" : "pointer",
              opacity: triggering ? 0.6 : 1,
              fontFamily: "inherit",
            }}
          >
            {triggering ? t("Triggering...") : t("Run now")}
          </button>
        </div>
      </div>

      {inFlight && (
        <div
          style={{
            padding: "6px 12px",
            background: "var(--info-bg)",
            color: "var(--info)",
            fontSize: 11,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span data-running-pulse="true" style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
          {t("Task running, auto-refreshing…")}
        </div>
      )}

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loading && runs.length === 0 && (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("Loading...")}
          </div>
        )}
        {!loading && runs.length === 0 && (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("No runs yet")}
          </div>
        )}
        {!loading && runs.length > 0 && filtered.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("No runs match this filter")}
          </div>
        )}
        {filtered.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            now={now}
            onOpenSession={onOpenSession}
          />
        ))}
      </div>
    </div>
  );
}

/** Threshold over which a running run is flagged as "long-running" in the
 *  UI. The status stays `running` (the agent is still doing real work) but
 *  the user gets a visible warning so they can decide whether to wait or
 *  abort. 10 minutes — matches the previous blanket timeout, but this is
 *  advisory only; the agent is allowed to keep running. */
const LONG_RUNNING_THRESHOLD_MS = 10 * 60 * 1000;

// ── Single run card ──────────────────────────────────────────────

function RunCard({ run, now, onOpenSession }: { run: TaskRun; now: number; onOpenSession: (id: string) => void }) {
  const { t, locale } = useI18n();
  const replyPreview = run.replyText?.slice(0, 240).trim() ?? null;
  const replyMore = run.replyText && run.replyText.length > 240;

  // For in-flight runs we don't know the duration yet, so we surface the
  // live elapsed time instead — and flag it as "long-running" once the
  // threshold is crossed so the user knows the agent is still busy.
  const isRunning = run.status === "running";
  const elapsedMs = isRunning ? Math.max(0, now - run.startedAt) : null;
  const isLongRunning = elapsedMs !== null && elapsedMs >= LONG_RUNNING_THRESHOLD_MS;

  return (
    <div
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StatusBadge status={run.status} size="md" />
        {isLongRunning && (
          <Tooltip content={t("Long-running run warning")}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 7px",
                background: "var(--warning-bg)",
                color: "var(--warning)",
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {t("Long-running")}
            </span>
          </Tooltip>
        )}
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {formatRelative(now, run.startedAt, locale)}
        </span>
        {run.durationMs !== null && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {formatDuration(run.durationMs)}
          </span>
        )}
        {elapsedMs !== null && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {formatDuration(elapsedMs)}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          {run.sessionId && (
            <Tooltip content={t("Open session")}>
              <button
                onClick={() => onOpenSession(run.sessionId!)}
                aria-label={t("Open session")}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text-muted)",
                  padding: "2px 6px",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <IconExternal width={10} height={10} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Body */}
      {run.error && (
        <div
          style={{
            fontSize: 11,
            color: run.status === "timeout" || run.status === "interrupted" ? "var(--warning)" : "var(--error)",
            fontFamily: "var(--font-mono)",
            background: run.status === "timeout" || run.status === "interrupted" ? "var(--warning-bg)" : "var(--error-bg)",
            padding: "6px 10px",
            borderRadius: 4,
            wordBreak: "break-word",
          }}
        >
          {t(run.error)}
        </div>
      )}
      {replyPreview && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text)",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {replyPreview}
          {replyMore && <span style={{ color: "var(--text-muted)" }}> ...</span>}
        </div>
      )}
      {run.status === "success" && !replyPreview && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("(no reply content)")}</div>
      )}
    </div>
  );
}

function countByStatus(runs: TaskRun[], filter: RunFilter): number {
  if (filter === "all") return runs.length;
  return runs.filter((r) => r.status === filter).length;
}