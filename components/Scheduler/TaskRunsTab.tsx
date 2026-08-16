/**
 * TaskRunsTab — run history for one task.
 *
 * Card-style list (vs. the old cramped rows) that shows:
 *   - status pill (success / error / timeout / running)
 *   - relative timestamp + duration + read state
 *   - reply preview (expandable), or error message
 *   - "open session" link when a session id is attached
 *
 * Auto-refreshes every 2s while a run is in flight so the running badge
 * stays accurate without the user having to manually refresh.
 */

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { StatusBadge } from "./StatusBadge";
import { useNow } from "./useNow";
import { apiFetch, formatDuration, formatRelative } from "./utils";
import type { ScheduledTask, TaskRun } from "./types";
import { IconExternal } from "./icons";

export type RunFilter = "all" | "success" | "error" | "timeout" | "running";

interface Props {
  task: ScheduledTask;
  runs: TaskRun[];
  loading: boolean;
  filter: RunFilter;
  onFilterChange: (f: RunFilter) => void;
  triggering: boolean;
  onTrigger: () => void;
  onRefresh: () => void;
  onRunsChange: (runs: TaskRun[]) => void;
  onTaskRefresh: () => void;
  onOpenSession: (sessionId: string) => void;
}

const FILTERS: { id: RunFilter; label: string }[] = [
  { id: "all",     label: "All" },
  { id: "success", label: "Success" },
  { id: "error",   label: "Errors" },
  { id: "timeout", label: "Timeout" },
  { id: "running", label: "Running" },
];

export function TaskRunsTab({
  task, runs, loading, filter, onFilterChange,
  triggering, onTrigger, onRefresh, onRunsChange, onTaskRefresh, onOpenSession,
}: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const now = useNow(2_000);

  const filtered = useMemo(() => {
    if (filter === "all") return runs;
    return runs.filter((r) => r.status === filter);
  }, [runs, filter]);

  const inFlight = runs.some((r) => r.status === "running");

  const toggleRead = async (run: TaskRun) => {
    const nextRead = run.readAt === null;
    onRunsChange(runs.map((r) => (r.id === run.id ? { ...r, readAt: nextRead ? Date.now() : null } : r)));
    try {
      await apiFetch(`/api/scheduled-tasks/runs/${encodeURIComponent(run.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ read: nextRead }),
      });
      onTaskRefresh();
    } catch (e) {
      onRunsChange(runs.map((r) => (r.id === run.id ? { ...r, readAt: run.readAt } : r)));
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to update run") });
    }
  };

  const markAllRead = async () => {
    try {
      await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}/runs/mark-all-read`, { method: "POST" });
      onRefresh();
      onTaskRefresh();
      toast.show({ kind: "success", message: t("All runs marked as read") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to toggle task") });
    }
  };

  const unreadExists = runs.some((r) => r.readAt === null);

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
          {unreadExists && (
            <button
              onClick={() => void markAllRead()}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t("Mark all as read")}
            </button>
          )}
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
            onToggleRead={() => void toggleRead(run)}
            onOpenSession={onOpenSession}
          />
        ))}
      </div>
    </div>
  );
}

// ── Single run card ──────────────────────────────────────────────

function RunCard({ run, now, onToggleRead, onOpenSession }: { run: TaskRun; now: number; onToggleRead: () => void; onOpenSession: (id: string) => void }) {
  const { t, locale } = useI18n();
  const isUnread = run.readAt === null;
  const replyPreview = run.replyText?.slice(0, 240).trim() ?? null;
  const replyMore = run.replyText && run.replyText.length > 240;

  return (
    <div
      style={{
        background: isUnread ? "var(--bg-subtle)" : "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderLeft: isUnread ? "2px solid var(--accent)" : "2px solid transparent",
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
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {formatRelative(now, run.startedAt, locale)}
        </span>
        {run.durationMs !== null && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {formatDuration(run.durationMs)}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <Tooltip content={isUnread ? t("Mark as read") : t("Mark as unread")}>
            <button
              onClick={onToggleRead}
              aria-label={isUnread ? t("Mark as read") : t("Mark as unread")}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: isUnread ? "var(--accent)" : "var(--text-dim)",
                padding: "1px 6px",
                fontSize: 10,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {isUnread ? "●" : "○"}
            </button>
          </Tooltip>
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
            color: run.status === "timeout" ? "var(--warning)" : "var(--error)",
            fontFamily: "var(--font-mono)",
            background: run.status === "timeout" ? "var(--warning-bg)" : "var(--error-bg)",
            padding: "6px 10px",
            borderRadius: 4,
            wordBreak: "break-word",
          }}
        >
          {run.error}
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