import { useMemo, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { StatusBadge } from "./StatusBadge";
import { useNow } from "./useNow";
import { formatDuration, formatRelative } from "./utils";
import type { TaskRun } from "@/lib/shared/scheduler";
import {
  computeSchedulerRunStats,
  countSchedulerRuns,
  filterSchedulerRuns,
  isSchedulerLongRunning,
  schedulerRunDurationMs,
  SCHEDULER_RUN_FILTERS,
  type SchedulerRunFilter,
} from "@/lib/shared/scheduler-runs";
import { AlertIcon, ChevronDownIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { useMarkdownComponents } from "@/components/chat/message-view/utils";

export type RunFilter = SchedulerRunFilter;

interface Props {
  runs: TaskRun[];
  loading: boolean;
  filter: RunFilter;
  onFilterChange: (f: RunFilter) => void;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onOpenSession: (sessionId: string) => void;
}

const FILTER_LABELS: Record<RunFilter, string> = {
  all: "All",
  success: "Success",
  error: "Errors",
  timeout: "Timeout",
  interrupted: "Interrupted",
  running: "Running",
};

export function TaskRunsTab({
  runs, loading, filter, onFilterChange, selectedRunId, onSelectRun, onOpenSession,
}: Props) {
  const { t } = useI18n();
  const now = useNow(2_000);

  const filtered = useMemo(() => filterSchedulerRuns(runs, filter), [runs, filter]);
  const stats = useMemo(() => computeSchedulerRunStats(runs), [runs]);
  const inFlight = runs.some((run) => run.status === "running");
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, rowGap: 4, flexWrap: "wrap" }}>
          <RunStat label={t("Total runs")} value={String(stats.total)} />
          <RunStat
            label={t("Success rate")}
            value={stats.completed === 0 ? "—" : `${Math.round(stats.successRate * 100)}%`}
          />
          <RunStat label={t("Avg duration")} value={formatDuration(stats.avgDurationMs) ?? "—"} />
          {inFlight && (
            <span
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                color: "var(--info)",
              }}
            >
              <span
                data-running-pulse="true"
                style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }}
              />
              {t("Task running, auto-refreshing…")}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {SCHEDULER_RUN_FILTERS.map((id) => {
            const active = filter === id;
            const count = countSchedulerRuns(runs, id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onFilterChange(id)}
                style={{
                  padding: "3px 10px",
                  fontSize: 12,
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
                {t(FILTER_LABELS[id])}
                {count > 0 && <span style={{ fontSize: 12 }}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: 12 }}>
        <div data-scroll-inset style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {loading && runs.length === 0 && <RunHint text={t("Loading...")} />}
          {!loading && runs.length === 0 && <RunHint text={t("No runs yet")} />}
          {!loading && runs.length > 0 && filtered.length === 0 && (
            <RunHint text={t("No runs match this filter")} />
          )}
          {filtered.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              now={now}
              selected={run.id === selectedRunId}
              onSelect={() => onSelectRun(run.id)}
              onOpenSession={onOpenSession}
            />
          ))}
        </div>

        <RunOutputPanel run={selectedRun} now={now} onOpenSession={onOpenSession} />
      </div>
    </div>
  );
}

function RunStat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>{value}</span>
    </span>
  );
}

function RunHint({ text }: { text: string }) {
  return <div style={{ padding: "24px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>{text}</div>;
}

function RunRow({
  run,
  now,
  selected,
  onSelect,
  onOpenSession,
}: {
  run: TaskRun;
  now: number;
  selected: boolean;
  onSelect: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t, locale } = useI18n();
  const durationMs = schedulerRunDurationMs(run, now);
  const longRunning = isSchedulerLongRunning(run, now);

  return (
    <div
      data-run-row={run.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto auto auto auto",
        alignItems: "center",
        gap: 10,
        height: 38,
        padding: "0 10px",
        margin: "0 10px",
        borderRadius: 6,
        cursor: "pointer",
        background: selected ? "var(--bg-selected)" : "transparent",
        borderBottom: "1px solid var(--border)",
        boxSizing: "border-box",
      }}
    >
      <StatusBadge status={run.status} size="sm" />
      <span
        style={{
          fontSize: 13,
          color: selected ? "var(--text)" : "var(--text-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {formatRelative(now, run.startedAt, locale)}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
        {formatDuration(durationMs) ?? "—"}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        {longRunning && (
          <Tooltip content={t("Long-running run warning")}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                padding: "2px 6px",
                background: "var(--warning-bg)",
                color: "var(--warning)",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              <AlertIcon size={9} strokeWidth={2.5} style={{ flexShrink: 0 }} />
              {t("Long-running")}
            </span>
          </Tooltip>
        )}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        {run.sessionId && (
          <Tooltip content={t("Open session")}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenSession(run.sessionId!);
              }}
              aria-label={t("Open session")}
              style={{
                background: "transparent",
                border: "none",
                borderRadius: 4,
                color: "var(--text-muted)",
                padding: "2px 6px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <ExternalLinkIcon width={11} height={11} />
            </button>
          </Tooltip>
        )}
      </span>
      <ChevronDownIcon
        width={12}
        height={12}
        aria-hidden="true"
        style={{
          color: selected ? "var(--accent)" : "var(--text-dim)",
          transform: selected ? "rotate(0deg)" : "rotate(-90deg)",
          transition: "transform 0.15s",
        }}
      />
    </div>
  );
}

function RunOutputPanel({
  run,
  now,
  onOpenSession,
}: {
  run: TaskRun | null;
  now: number;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t, locale } = useI18n();
  const markdownComponents = useMarkdownComponents(false);

  return (
    <div data-run-output style={outputPanelStyle}>
      {run !== null && (
        <div style={outputHeaderStyle}>
          <StatusBadge status={run.status} size="sm" />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {formatRelative(now, run.startedAt, locale)}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {formatDuration(schedulerRunDurationMs(run, now)) ?? "—"}
          </span>
          {run.sessionId && (
            <button
              type="button"
              onClick={() => onOpenSession(run.sessionId!)}
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 7px",
                fontSize: 12,
                background: "transparent",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t("Open session")}
              <ExternalLinkIcon width={10} height={10} />
            </button>
          )}
        </div>
      )}

      <div
        data-scroll-inset
        className={run?.replyText?.trim() ? "markdown-body" : undefined}
        style={outputBodyStyle}
      >
        {run === null ? (
          <RunHint text={t("Select a run to see its output")} />
        ) : (
          <>
            {run.error && (
              <div
                style={{
                  fontSize: 13,
                  color:
                    run.status === "timeout" || run.status === "interrupted"
                      ? "var(--warning)"
                      : "var(--error)",
                  fontFamily: "var(--font-mono)",
                  background:
                    run.status === "timeout" || run.status === "interrupted"
                      ? "var(--warning-bg)"
                      : "var(--error-bg)",
                  padding: "6px 10px",
                  borderRadius: 4,
                  marginBottom: run.replyText?.trim() ? 10 : 0,
                  wordBreak: "break-word",
                }}
              >
                {t(run.error)}
              </div>
            )}
            {run.replyText?.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {run.replyText}
              </ReactMarkdown>
            ) : (
              !run.error && (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {run.status === "running"
                    ? t("Waiting for output…")
                    : run.status === "success"
                      ? t("(no reply content)")
                      : t("No output")}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

const outputPanelStyle: CSSProperties = {
  flex: "0 0 45%",
  minHeight: 200,
  maxHeight: "60%",
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  borderTop: "1px solid var(--border)",
  overflow: "hidden",
};

const outputHeaderStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px 6px",
};

const outputBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "10px 12px",
};
