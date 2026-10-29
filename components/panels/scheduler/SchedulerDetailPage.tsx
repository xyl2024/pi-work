"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { StatusBadge } from "@/components/scheduler/StatusBadge";
import { CronHumanizer } from "@/components/scheduler/CronHumanizer";
import { TaskOverviewTab } from "@/components/scheduler/TaskOverviewTab";
import { TaskRunsTab, type RunFilter } from "@/components/scheduler/TaskRunsTab";
import { TaskPromptTab } from "@/components/scheduler/TaskPromptTab";
import { TaskConfigTab } from "@/components/scheduler/TaskConfigTab";
import { isOnceDone } from "@/components/scheduler/utils";
import { tabBarStyle, tabItemStyle } from "@/components/scheduler/styles";
import { fetchTaskRuns, fetchWechatChannels } from "@/lib/client/scheduler-io";
import {
  openSchedulerForm,
  removeSchedulerTask,
  setSchedulerRunsVisible,
  toggleSchedulerTask,
  triggerSchedulerTaskNow,
  useSchedulerStore,
} from "@/lib/client/scheduler-store";
import { SchedulerBackButton } from "./SchedulerBackButton";
import type { SchedulerDetailBlock, TaskRun } from "@/lib/shared/scheduler";
import { EditIcon, PlayIcon, TrashIcon } from "@/components/ui/icons";

interface ChannelMeta {
  [channelId: string]: { name: string; status: string };
}

/**
 * The scheduler panel's detail page: one task across four horizontal blocks
 * (overview / runs / prompt / config). Full width, with a back control to the
 * list and the live actions (toggle, edit, run now, delete) in the header.
 *
 * The run history is owned here, not in the module store: it is volatile data
 * that is re-read while a run is in flight, so caching it would only add a
 * second, possibly stale copy. The page also reports whether the runs block is
 * on screen, which is what lets the store's background poll run at its fast
 * tier (see `lib/shared/scheduler-cadence.ts`).
 */
export function SchedulerDetailPage({
  taskId,
  onOpenSession,
}: {
  taskId: string;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { tasks, meta, triggering } = useSchedulerStore();
  const task = tasks.find((item) => item.id === taskId) ?? null;

  const [block, setBlock] = useState<SchedulerDetailBlock>("overview");
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  const [channelMeta, setChannelMeta] = useState<ChannelMeta | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      setRuns(await fetchTaskRuns(taskId));
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to load runs") });
    } finally {
      setRunsLoading(false);
    }
  }, [taskId, toast, t]);

  // Reset per-task state and read the run history whenever the page changes task.
  useEffect(() => {
    setBlock("overview");
    setRuns([]);
    setRunFilter("all");
    void loadRuns();
  }, [taskId, loadRuns]);

  // Tell the store when the fast poll tier applies.
  useEffect(() => {
    setSchedulerRunsVisible(block === "runs");
    return () => setSchedulerRunsVisible(false);
  }, [block]);

  // Re-read the runs while one is in flight on screen, and pause the loop
  // while the browser tab is in the background (the store's own poll does the
  // same; both are covered by the spec's "hidden ⇒ paused" rule).
  useEffect(() => {
    if (block !== "runs") return;
    if (!runs.some((run) => run.status === "running")) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => void loadRuns(), 2_000);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void loadRuns();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [block, runs, loadRuns]);

  // Channel metadata for the read-only notification rows.
  useEffect(() => {
    let alive = true;
    void fetchWechatChannels().then((channels) => {
      if (!alive) return;
      const meta: ChannelMeta = {};
      for (const channel of channels) meta[channel.id] = { name: channel.name, status: channel.status };
      setChannelMeta(meta);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (task === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{ padding: "12px 14px", flexShrink: 0 }}>
          <SchedulerBackButton />
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
          {t("Task not found")}
        </div>
      </div>
    );
  }

  const handleToggle = async (nextEnabled: boolean) => {
    try {
      await toggleSchedulerTask(task.id, nextEnabled);
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to toggle task") });
    }
  };

  const handleTrigger = async () => {
    try {
      const triggered = await triggerSchedulerTaskNow(task.id);
      if (!triggered) return; // a trigger was already in flight — nothing was sent
      toast.show({ kind: "success", message: t("Task triggered") });
      void loadRuns();
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to trigger task") });
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: t("Delete task"),
      description: t("Delete this task and all its run history? This cannot be undone."),
      confirmLabel: t("Delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeSchedulerTask(task.id);
      toast.show({ kind: "success", message: t("Task deleted") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Delete failed") });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: "10px 14px 8px", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SchedulerBackButton />
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              color: "var(--text)",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {task.name}
          </h2>
          <StatusBadge status={isOnceDone(task) ? "done" : task.enabled ? "enabled" : "paused"} size="md" />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-muted)" }}>
          <CronHumanizer cron={task.cron} previewCount={5} showCode timezone={task.timezone} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <ToggleSwitch on={task.enabled} onChange={(next) => void handleToggle(next)} size="sm" label={t("Enabled")} />
          <button
            type="button"
            onClick={() => openSchedulerForm(task, null)}
            style={actionButtonStyle}
          >
            <EditIcon width={11} height={11} />
            {t("Edit")}
          </button>
          <button
            type="button"
            onClick={() => void handleTrigger()}
            disabled={triggering}
            style={{ ...actionButtonStyle, cursor: triggering ? "default" : "pointer", opacity: triggering ? 0.6 : 1 }}
          >
            <PlayIcon width={11} height={11} />
            {triggering ? t("Triggering...") : t("Run now")}
          </button>
          <Tooltip content={t("Delete task")}>
            <button
              type="button"
              onClick={() => void handleDelete()}
              aria-label={t("Delete task")}
              style={{ ...iconButtonStyle, color: "var(--error)" }}
            >
              <TrashIcon width={12} height={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Blocks bar — four segments that wrap instead of squeezing. */}
      <div style={{ ...tabBarStyle, flexWrap: "wrap" }}>
        {(
          [
            { id: "overview", label: t("Overview") },
            { id: "runs", label: `${t("Runs")} (${runs.length})` },
            { id: "prompt", label: t("Prompt") },
            { id: "config", label: t("Config") },
          ] as const
        ).map((item) => (
          <button key={item.id} type="button" onClick={() => setBlock(item.id)} style={tabItemStyle(block === item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {/* Block body */}
      <div data-scroll-wide style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 14px" }}>
        {block === "overview" && (
          <TaskOverviewTab task={task} runs={runs} channelMeta={channelMeta} modelIcons={meta?.modelIcons} modelIconPreferences={meta?.modelIconPreferences} />
        )}
        {block === "runs" && (
          <TaskRunsTab
            runs={runs}
            loading={runsLoading}
            filter={runFilter}
            onFilterChange={setRunFilter}
            triggering={triggering}
            onTrigger={() => void handleTrigger()}
            onOpenSession={onOpenSession}
          />
        )}
        {block === "prompt" && <TaskPromptTab task={task} />}
        {block === "config" && (
          <TaskConfigTab task={task} modelIcons={meta?.modelIcons} modelIconPreferences={meta?.modelIconPreferences} channelMeta={channelMeta} onEdit={() => openSchedulerForm(task, null)} />
        )}
      </div>
    </div>
  );
}

const actionButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 10px",
  fontSize: 12,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
  fontFamily: "inherit",
} as const;

const iconButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "inherit",
} as const;
