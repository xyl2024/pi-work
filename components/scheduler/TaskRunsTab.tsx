import { useMemo, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { CollapsiblePanel } from "@/components/ui/CollapsiblePanel";
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
  onSelectRun: (runId: string | null) => void;
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
                  borderRadius: "var(--radius-pill)",
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

      <div data-scroll-inset style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {loading && runs.length === 0 && <RunHint text={t("Loading...")} />}
        {!loading && runs.length === 0 && <RunHint text={t("No runs yet")} />}
        {!loading && runs.length > 0 && filtered.length === 0 && (
          <RunHint text={t("No runs match this filter")} />
        )}
        {filtered.map((run) => {
          const expanded = run.id === selectedRunId;
          return (
            <div key={run.id}>
              <RunRow
                run={run}
                now={now}
                expanded={expanded}
                onToggle={() => onSelectRun(expanded ? null : run.id)}
                onOpenSession={onOpenSession}
              />
              <CollapsiblePanel open={expanded}>
                <RunOutput run={run} />
              </CollapsiblePanel>
            </div>
          );
        })}
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
  expanded,
  onToggle,
  onOpenSession,
}: {
  run: TaskRun;
  now: number;
  expanded: boolean;
  onToggle: () => void;
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
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
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
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        background: expanded ? "var(--bg-selected)" : "transparent",
        borderBottom: expanded ? "none" : "1px solid var(--border)",
        boxSizing: "border-box",
      }}
    >
      <StatusBadge status={run.status} size="sm" />
      <span
        style={{
          fontSize: 13,
          color: expanded ? "var(--text)" : "var(--text-muted)",
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
                borderRadius: "var(--radius-pill)",
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
                borderRadius: "var(--radius-xs)",
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
          color: expanded ? "var(--accent)" : "var(--text-dim)",
          transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          transition: "transform var(--dur-base) var(--ease-standard)",
        }}
      />
    </div>
  );
}

function RunOutput({ run }: { run: TaskRun }) {
  const { t } = useI18n();
  const markdownComponents = useMarkdownComponents(false);

  return (
    <div
      data-run-output={run.id}
      data-scroll-inset
      className={run.replyText?.trim() ? "markdown-body" : undefined}
      style={outputBodyStyle}
    >
      {run.error && (
        <div
          style={{
            fontSize: 13,
            color:
              run.status === "timeout" || run.status === "interrupted" ? "var(--warning)" : "var(--error)",
            fontFamily: "var(--font-mono)",
            background:
              run.status === "timeout" || run.status === "interrupted" ? "var(--warning-bg)" : "var(--error-bg)",
            padding: "6px 10px",
            borderRadius: "var(--radius-xs)",
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
    </div>
  );
}

const outputBodyStyle: CSSProperties = {
  maxHeight: 360,
  overflowY: "auto",
  overflowX: "hidden",
  boxSizing: "border-box",
  margin: "0 10px 8px",
  padding: "10px 12px",
  borderRadius: "var(--radius-sm)",
};
