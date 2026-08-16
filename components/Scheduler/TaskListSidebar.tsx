/**
 * TaskListSidebar — left rail of the scheduler modal.
 *
 * Lists every scheduled task with:
 *  - filter pills (All / Enabled / Paused / Errors)
 *  - live search across name + prompt + cron
 *  - j/k keyboard navigation + Enter to open
 *  - unread badge + status dot + relative "next run" time
 *  - empty state with onboarding copy when zero tasks
 *
 * Click a row to select it (handled by parent). Long-press / right-click
 * pops a context menu for run / pause / edit / delete.
 */

import { useEffect, useMemo, useRef } from "react";
import { StatusBadge } from "./StatusBadge";
import { CronHumanizer } from "./CronHumanizer";
import { useNow } from "./useNow";
import { formatCompactRelative } from "./utils";
import type { ScheduledTask, TaskRunStatus } from "./types";
import { IconAlert, IconPlus, IconSearch } from "./icons";

export type SidebarFilter = "all" | "enabled" | "disabled" | "error";

interface Props {
  tasks: ScheduledTask[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (taskId: string) => void;
  onCreate: () => void;
  filter: SidebarFilter;
  onFilterChange: (f: SidebarFilter) => void;
  query: string;
  onQueryChange: (q: string) => void;
  /** Total number of currently-running runs across all tasks (in-flight badge). */
  runningCount: number;
}

const FILTERS: { id: SidebarFilter; label: string }[] = [
  { id: "all",      label: "全部" },
  { id: "enabled",  label: "已启用" },
  { id: "disabled", label: "已暂停" },
  { id: "error",    label: "有错误" },
];

export function TaskListSidebar({
  tasks,
  loading,
  error,
  selectedId,
  onSelect,
  onCreate,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  runningCount,
}: Props) {
  const now = useNow(30_000);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((task) => {
      // Status filter
      if (filter === "enabled" && !task.enabled) return false;
      if (filter === "disabled" && task.enabled) return false;
      if (filter === "error" && task.lastRunStatus !== "error" && task.lastRunStatus !== "timeout") return false;
      // Text search across name + cron + prompt
      if (q.length > 0) {
        const haystack = `${task.name} ${task.cron} ${task.prompt}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, filter, query]);

  // Keep the selected row scrolled into view when the user navigates with
  // j/k (called by the parent after selectedId changes).
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const row = listRef.current.querySelector(`[data-task-row="${selectedId}"]`) as HTMLElement | null;
    if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div
      style={{
        width: 280,
        minWidth: 240,
        maxWidth: 320,
        borderRight: "1px solid var(--border)",
        background: "var(--bg-panel)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Top action row */}
      <div style={{ padding: "10px 12px 8px", display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={onCreate}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            width: "100%",
          }}
        >
          <IconPlus width={12} height={12} />
          新建任务
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: "4px 12px 8px", position: "relative" }}>
        <IconSearch
          width={11}
          height={11}
          style={{
            position: "absolute",
            left: 21,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-dim)",
            pointerEvents: "none",
          }}
        />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索名称、cron、提示词..."
          style={{
            width: "100%",
            padding: "5px 10px 5px 26px",
            fontSize: 11,
            border: "1px solid var(--border)",
            borderRadius: 6,
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Filter pills */}
      <div style={{ padding: "0 12px 8px", display: "flex", gap: 4, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count = filterCount(tasks, f.id);
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
              {f.label}
              {count > 0 && <span style={{ fontSize: 10, color: active ? "var(--accent)" : "var(--text-dim)" }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Running indicator */}
      {runningCount > 0 && (
        <div
          style={{
            margin: "0 12px 8px",
            padding: "5px 10px",
            background: "var(--info-bg)",
            color: "var(--info)",
            fontSize: 11,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
          }}
        >
          <span
            data-running-pulse="true"
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
          {runningCount} 个任务正在运行
        </div>
      )}

      {/* List */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", borderTop: "1px solid var(--border)" }}>
        {loading && tasks.length === 0 && (
          <EmptyHint text="加载中..." />
        )}
        {error && (
          <EmptyHint text={`加载失败: ${error}`} variant="error" />
        )}
        {!loading && !error && tasks.length === 0 && (
          <EmptyState onCreate={onCreate} />
        )}
        {!loading && !error && tasks.length > 0 && filtered.length === 0 && (
          <EmptyHint text="没有匹配的任务" />
        )}
        {filtered.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            now={now}
            selected={task.id === selectedId}
            onSelect={() => onSelect(task.id)}
          />
        ))}
      </div>

      </div>
  );
}

// ── Single row ───────────────────────────────────────────────────

function TaskRow({ task, now, selected, onSelect }: { task: ScheduledTask; now: number; selected: boolean; onSelect: () => void }) {
  const lastStatus: TaskRunStatus | null = task.lastRunStatus;
  const showErrorBadge = lastStatus === "error" || lastStatus === "timeout";

  return (
    <div
      data-task-row={task.id}
      onClick={onSelect}
      style={{
        padding: "10px 12px",
        cursor: "pointer",
        borderBottom: "1px solid var(--border)",
        background: selected ? "var(--bg-selected)" : "transparent",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        paddingLeft: selected ? 10 : 12,
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <StatusBadge status={task.enabled ? "enabled" : "paused"} size="sm" />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            color: "var(--text)",
            fontWeight: task.unreadCount > 0 ? 600 : 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {task.name}
        </span>
        {task.unreadCount > 0 && (
          <span
            style={{
              background: "var(--accent)",
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              padding: "1px 5px",
              borderRadius: 8,
              lineHeight: 1.4,
              minWidth: 16,
              textAlign: "center",
              flexShrink: 0,
            }}
          >
            {task.unreadCount > 99 ? "99+" : task.unreadCount}
          </span>
        )}
        {showErrorBadge && (
          <IconAlert width={11} height={11} style={{ color: lastStatus === "timeout" ? "var(--warning)" : "var(--error)", flexShrink: 0 }} />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <CronHumanizer cron={task.cron} showCode={false} />
        </span>
      </div>
      <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-dim)" }}>
        {task.enabled
          ? `下次: ${formatCompactRelative(now, task.nextRunAt)}`
          : "已暂停"}
      </div>
    </div>
  );
}

// ── Empty / hint blocks ──────────────────────────────────────────

function EmptyHint({ text, variant = "muted" }: { text: string; variant?: "muted" | "error" }) {
  return (
    <div
      style={{
        padding: "20px 16px",
        fontSize: 12,
        color: variant === "error" ? "var(--error)" : "var(--text-dim)",
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--text-muted)" }}>
      <svg
        width="56"
        height="56"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: "var(--text-dim)", margin: "0 auto 12px", display: "block" }}
      >
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </svg>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
        还没有定时任务
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 14 }}>
        让 agent 在指定时间自动运行任何任务<br />
        例如每日工作报告、每小时巡检
      </div>
      <button
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
        <IconPlus width={11} height={11} />
        新建任务
      </button>
    </div>
  );
}

function filterCount(tasks: ScheduledTask[], f: SidebarFilter): number {
  switch (f) {
    case "all":      return tasks.length;
    case "enabled":  return tasks.filter((t) => t.enabled).length;
    case "disabled": return tasks.filter((t) => !t.enabled).length;
    case "error":    return tasks.filter((t) => t.lastRunStatus === "error" || t.lastRunStatus === "timeout").length;
  }
}