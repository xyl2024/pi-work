"use client";

import { useMemo, useRef, useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";
import { StatusBadge } from "@/components/scheduler/StatusBadge";
import { CronHumanizer } from "@/components/scheduler/CronHumanizer";
import { useNow } from "@/components/scheduler/useNow";
import { formatCompactRelative, isOnceDone } from "@/components/scheduler/utils";
import {
  openSchedulerForm,
  openSchedulerTask,
  setSchedulerFilter,
  setSchedulerQuery,
  useSchedulerStore,
  type SchedulerFilter,
} from "@/lib/client/scheduler-store";
import type { ScheduledTask, TaskRunStatus } from "@/lib/shared/scheduler";
import { AlertIcon, ClockIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";

/**
 * The scheduler panel's root page: every task, with search, filters, a
 * running-tasks banner and the create entry. Full width — the two-column modal
 * split is gone, so a row navigates to the task's detail page instead of
 * filling a right pane.
 *
 * All list state (search word, filter, the list itself) lives in the module
 * store, so a tab switch never resets it. The page is otherwise a pure view.
 */
export function SchedulerRootPage({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const { tasks, loaded, loadError, filter, query, selectedTaskId } = useSchedulerStore();
  const now = useNow(30_000);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterTasks(tasks, filter, query), [tasks, filter, query]);
  const runningCount = tasks.filter((task) => task.lastRunStatus === "running").length;

  // Keep the opened task visible when the panel reopens on the list.
  useEffect(() => {
    if (!selectedTaskId || !listRef.current) return;
    const row = listRef.current.querySelector(`[data-task-row="${selectedTaskId}"]`) as HTMLElement | null;
    if (row) row.scrollIntoView({ block: "nearest" });
  }, [selectedTaskId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header: count + create */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 8px", flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("Scheduled tasks")}</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {tasks.length > 0 ? t("{n} tasks", { n: tasks.length }) : ""}
        </span>
        <button
          type="button"
          onClick={() => openSchedulerForm(null, cwd)}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 11px",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          <PlusIcon width={11} height={11} />
          {t("New task")}
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: "0 14px 8px", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <SearchIcon
            width={11}
            height={11}
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-dim)",
              pointerEvents: "none",
            }}
          />
          <input
            value={query}
            onChange={(e) => setSchedulerQuery(e.target.value)}
            placeholder={t("Search name, cron, prompt...")}
            className="scheduler-text-input"
            style={{
              width: "100%",
              padding: "5px 10px 5px 26px",
              fontSize: 12,
              border: "1px solid var(--scheduler-input-border, var(--border))",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--text)",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {/* Filter pills */}
      <div style={{ padding: "0 14px 8px", display: "flex", gap: 4, flexWrap: "wrap", flexShrink: 0 }}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count = filterCount(tasks, f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setSchedulerFilter(f.id)}
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
              {count > 0 && <span style={{ fontSize: 11 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Running banner */}
      {runningCount > 0 && (
        <div
          style={{
            margin: "0 14px 8px",
            padding: "5px 10px",
            background: "var(--info-bg)",
            color: "var(--info)",
            fontSize: 11,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          <span
            data-running-pulse="true"
            style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "currentColor" }}
          />
          {t("{n} tasks running", { n: runningCount })}
        </div>
      )}

      {/* List */}
      <div ref={listRef} data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {!loaded && !loadError && <EmptyHint text={t("Loading...")} />}
        {loadError && <EmptyHint text={t("Failed to load: {error}", { error: loadError })} variant="error" />}
        {loaded && !loadError && tasks.length === 0 && (
          <EmptyState onCreate={() => openSchedulerForm(null, cwd)} />
        )}
        {loaded && !loadError && tasks.length > 0 && filtered.length === 0 && (
          <EmptyHint text={t("No matching tasks")} />
        )}
        {filtered.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            now={now}
            selected={task.id === selectedTaskId}
            onSelect={() => openSchedulerTask(task.id)}
          />
        ))}
      </div>
    </div>
  );
}

const FILTERS: { id: SchedulerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "enabled", label: "Enabled" },
  { id: "disabled", label: "Paused" },
  { id: "error", label: "Has errors" },
];

function isErrorStatus(status: TaskRunStatus | null): boolean {
  return status === "error" || status === "timeout" || status === "interrupted";
}

function filterTasks(tasks: ScheduledTask[], filter: SchedulerFilter, query: string): ScheduledTask[] {
  const q = query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (filter === "enabled" && !task.enabled) return false;
    if (filter === "disabled" && task.enabled) return false;
    if (filter === "error" && !isErrorStatus(task.lastRunStatus)) return false;
    if (q.length > 0) {
      const haystack = `${task.name} ${task.cron} ${task.prompt}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function filterCount(tasks: ScheduledTask[], filter: SchedulerFilter): number {
  switch (filter) {
    case "all":
      return tasks.length;
    case "enabled":
      return tasks.filter((t) => t.enabled).length;
    case "disabled":
      return tasks.filter((t) => !t.enabled).length;
    case "error":
      return tasks.filter((t) => isErrorStatus(t.lastRunStatus)).length;
  }
}

function TaskRow({
  task,
  now,
  selected,
  onSelect,
}: {
  task: ScheduledTask;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, locale } = useI18n();
  const showErrorBadge = isErrorStatus(task.lastRunStatus);

  const nextLabel = !task.enabled
    ? t("Paused")
    : isOnceDone(task)
      ? t("Executed")
      : t("Next: {time}", { time: formatCompactRelative(now, task.nextRunAt, locale) });

  return (
    <div
      data-task-row={task.id}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      style={{
        margin: "2px 10px",
        padding: "9px 11px",
        cursor: "pointer",
        background: selected ? "var(--bg-selected)" : "transparent",
        borderRadius: 8,
        transition: "background 0.12s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <StatusBadge status={isOnceDone(task) ? "done" : task.enabled ? "enabled" : "paused"} size="sm" bare />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            color: "var(--text)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {task.name}
        </span>
        {showErrorBadge && (
          <AlertIcon
            width={11}
            height={11}
            style={{
              color:
                task.lastRunStatus === "timeout" || task.lastRunStatus === "interrupted"
                  ? "var(--warning)"
                  : "var(--error)",
              flexShrink: 0,
            }}
          />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.35 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <CronHumanizer cron={task.cron} showCode={false} timezone={task.timezone} />
        </span>
        <span style={{ flexShrink: 0, opacity: 0.75 }}>·</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nextLabel}</span>
      </div>
    </div>
  );
}

function EmptyHint({ text, variant = "muted" }: { text: string; variant?: "muted" | "error" }) {
  return (
    <div
      style={{
        padding: "20px 16px",
        fontSize: 12,
        color: variant === "error" ? "var(--error)" : "var(--text-muted)",
        textAlign: "center",
        wordBreak: "break-word",
      }}
    >
      {text}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--text-muted)" }}>
      <ClockIcon size={56} strokeWidth={1.2} style={{ color: "var(--text-muted)", margin: "0 auto 12px", display: "block" }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
        {t("No scheduled tasks yet")}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 14 }}>
        {t("Let the agent run any task automatically at a scheduled time")}
        <br />
        {t("e.g. daily report, hourly checks")}
      </div>
      <button
        type="button"
        onClick={onCreate}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <PlusIcon width={11} height={11} />
        {t("New task")}
      </button>
    </div>
  );
}
