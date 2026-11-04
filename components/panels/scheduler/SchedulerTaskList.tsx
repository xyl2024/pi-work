"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { StatusBadge } from "@/components/scheduler/StatusBadge";
import { CronHumanizer } from "@/components/scheduler/CronHumanizer";
import { useNow } from "@/components/scheduler/useNow";
import { formatCompactRelative, isOnceDone } from "@/components/scheduler/utils";
import {
  openSchedulerForm,
  openSchedulerTask,
  setSchedulerFilter,
  setSchedulerQuery,
  toggleSchedulerTask,
  useSchedulerPanel,
} from "@/lib/client/scheduler-panel";
import {
  countSchedulerTasks,
  filterSchedulerTasks,
  isSchedulerErrorStatus,
  type SchedulerFilter,
} from "@/lib/shared/scheduler-filter";
import type { ScheduledTask } from "@/lib/shared/scheduler";
import { AlertIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";

const FILTERS: { id: SchedulerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "enabled", label: "Enabled" },
  { id: "disabled", label: "Paused" },
  { id: "error", label: "Has errors" },
];

export function SchedulerTaskList({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const { view } = useSchedulerPanel();
  const { tasks, loaded, loadError, filter, query, selectedTaskId } = view;
  const now = useNow(30_000);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterSchedulerTasks(tasks, filter, query), [tasks, filter, query]);
  const runningCount = tasks.filter((task) => task.lastRunStatus === "running").length;

  useEffect(() => {
    if (!selectedTaskId || !listRef.current) return;
    const row = listRef.current.querySelector(`[data-task-row="${selectedTaskId}"]`) as HTMLElement | null;
    if (row) row.scrollIntoView({ block: "nearest" });
  }, [selectedTaskId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 8px", flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{t("Scheduled tasks")}</span>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {tasks.length > 0 ? t("{n} tasks", { n: tasks.length }) : ""}
        </span>
        <button
          type="button"
          onClick={() => void openSchedulerForm(null, cwd)}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 12px",
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

      <div style={{ padding: "0 16px 8px", flexShrink: 0 }}>
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
              padding: "6px 10px 6px 26px",
              fontSize: 13,
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

      <div style={{ padding: "0 16px 12px", display: "flex", gap: 4, flexWrap: "wrap", flexShrink: 0 }}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count = countSchedulerTasks(tasks, f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setSchedulerFilter(f.id)}
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
              {t(f.label)}
              {count > 0 && <span style={{ fontSize: 12 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {runningCount > 0 && (
        <div
          style={{
            margin: "0 16px 8px",
            padding: "6px 10px",
            background: "var(--info-bg)",
            color: "var(--info)",
            fontSize: 12,
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

      <div ref={listRef} data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {!loaded && !loadError && <EmptyHint text={t("Loading...")} />}
        {loadError && <EmptyHint text={t("Failed to load: {error}", { error: loadError })} variant="error" />}
        {loaded && !loadError && tasks.length === 0 && <EmptyHint text={t("No scheduled tasks yet")} />}
        {loaded && !loadError && tasks.length > 0 && filtered.length === 0 && (
          <EmptyHint text={t("No matching tasks")} />
        )}
        {filtered.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            now={now}
            selected={task.id === selectedTaskId}
            onSelect={() => void openSchedulerTask(task.id)}
          />
        ))}
      </div>
    </div>
  );
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
  const toast = useToast();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const showErrorBadge = isSchedulerErrorStatus(task.lastRunStatus);
  const actionsVisible = hovered || focused || selected;

  const nextLabel = !task.enabled
    ? t("Paused")
    : isOnceDone(task)
      ? t("Executed")
      : t("Next: {time}", { time: formatCompactRelative(now, task.nextRunAt, locale) });

  const handleToggle = async (enabled: boolean) => {
    try {
      await toggleSchedulerTask(task.id, enabled);
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to toggle task") });
    }
  };

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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 2,
        minHeight: 40,
        boxSizing: "border-box",
        margin: "0 8px",
        padding: "4px 10px",
        cursor: "pointer",
        background: selected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderRadius: 6,
        transition: "background 0.12s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, lineHeight: 1.25 }}>
        <StatusBadge status={isOnceDone(task) ? "done" : task.enabled ? "enabled" : "paused"} size="sm" bare />
        <span
          style={{
            flex: 1,
            minWidth: 0,
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
        <span style={{ visibility: actionsVisible ? "visible" : "hidden", display: "inline-flex", flexShrink: 0 }}>
          <ToggleSwitch
            on={task.enabled}
            onChange={(next) => void handleToggle(next)}
            size="sm"
            label={t("Enabled")}
          />
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.25 }}>
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
