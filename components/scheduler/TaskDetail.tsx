/**
 * TaskDetail — the right pane of the scheduler modal.
 *
 * Three slots:
 *   - Header bar: task title + status + cron + action buttons
 *   - Tab bar (overview / runs / prompt / config)
 *   - Active tab body
 *
 * Auto-refreshes runs every 2s while a task is in flight. The "trigger"
 * button here is the same one that runs the runs tab; the parent owns
 * the state machine for which tab is active and passes the trigger
 * callback through.
 */

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { StatusBadge } from "./StatusBadge";
import { CronHumanizer } from "./CronHumanizer";
import { TaskOverviewTab } from "./TaskOverviewTab";
import { TaskRunsTab, type RunFilter } from "./TaskRunsTab";
import { TaskPromptTab } from "./TaskPromptTab";
import { TaskConfigTab } from "./TaskConfigTab";
import { TogglePill } from "@/components/ui/TogglePill";
import { apiFetch, isOnceDone } from "./utils";
import { tabBarStyle, tabItemStyle } from "./styles";
import type { DetailTab, ScheduledTask, TaskRun } from "./types";
import { EditIcon, PlayIcon, TrashIcon } from "@/components/ui/icons";

interface ChannelMeta {
  id: string;
  name: string;
  status: string;
}

interface Props {
  task: ScheduledTask;
  modelIcons?: Record<string, string>;
  triggering: boolean;
  onToggleEnabled: (task: ScheduledTask) => Promise<void> | void;
  onTrigger: (task: ScheduledTask) => Promise<void> | void;
  onEdit: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => Promise<void> | void;
  onOpenSession: (sessionId: string) => void;
  onTaskUpdated: (task: ScheduledTask) => void;
}

export function TaskDetail({
  task, modelIcons, triggering, onToggleEnabled, onTrigger, onEdit, onDelete, onOpenSession, onTaskUpdated,
}: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState<DetailTab>("overview");
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  /** channelId → { name, status } for rendering wechat notification targets. */
  const [channelMeta, setChannelMeta] = useState<Record<string, { name: string; status: string }> | null>(null);

  // Fetch channel metadata once so the config tab can show channel names
  // instead of raw ids (and "channel unavailable" when a channel is gone).
  useEffect(() => {
    let alive = true;
    fetch("/api/channels?provider=wechat", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.resolve({ channels: [] })))
      .then((data: { channels?: ChannelMeta[] }) => {
        if (!alive) return;
        const meta: Record<string, { name: string; status: string }> = {};
        for (const channel of data.channels ?? []) {
          meta[channel.id] = { name: channel.name, status: channel.status };
        }
        setChannelMeta(meta);
      })
      .catch(() => { /* keep null */ });
    return () => { alive = false; };
  }, [task.id]);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await apiFetch<{ runs: TaskRun[] }>(`/api/scheduled-tasks/${encodeURIComponent(task.id)}/runs`);
      setRuns(data.runs ?? []);
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to load runs") });
    } finally {
      setRunsLoading(false);
    }
  }, [task.id, toast, t]);

  // Fetch runs when the tab changes to "runs" or when the task id changes.
  useEffect(() => {
    setTab("overview");
    setRuns([]);
    setRunFilter("all");
    void loadRuns();
  }, [task.id, loadRuns]);

  // When the runs tab opens, kick off a fresh load.
  useEffect(() => {
    if (tab === "runs") void loadRuns();
  }, [tab, loadRuns]);

  // Auto-refresh while a run is in flight (every 2s).
  useEffect(() => {
    if (tab !== "runs") return;
    const inFlight = runs.some((r) => r.status === "running");
    if (!inFlight) return;
    const id = setInterval(() => void loadRuns(), 2000);
    return () => clearInterval(id);
  }, [tab, runs, loadRuns]);

  const handleToggle = async (nextEnabled: boolean) => {
    await onToggleEnabled({ ...task, enabled: nextEnabled });
    onTaskUpdated({ ...task, enabled: nextEnabled });
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: t("Delete task"),
      description: t("Delete this task and all its run history? This cannot be undone."),
      confirmLabel: t("Delete"),
      destructive: true,
    });
    if (!ok) return;
    await onDelete(task);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg)" }}>
      {/* Header */}
      <div
        style={{
          padding: "14px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {task.name}
          </h2>
          <StatusBadge status={isOnceDone(task) ? "done" : task.enabled ? "enabled" : "paused"} size="md" />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-muted)" }}>
          <CronHumanizer cron={task.cron} previewCount={5} showCode timezone={task.timezone} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <TogglePill
            on={task.enabled}
            onChange={(next) => void handleToggle(next)}
            size="sm"
            label={t("Enabled")}
          />
          <button
            onClick={() => onEdit(task)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              fontSize: 12,
              background: "var(--bg)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <EditIcon width={11} height={11} />
            {t("Edit")}
          </button>
          <button
            onClick={() => void onTrigger(task)}
            disabled={triggering}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              fontSize: 12,
              background: "var(--bg)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: triggering ? "default" : "pointer",
              opacity: triggering ? 0.6 : 1,
              fontFamily: "inherit",
            }}
          >
            <PlayIcon width={11} height={11} />
            {triggering ? t("Triggering...") : t("Run now")}
          </button>
          <Tooltip content={t("Delete task")}>
            <button
              onClick={() => void handleDelete()}
              aria-label={t("Delete task")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                padding: 0,
                background: "var(--bg)",
                borderRadius: 6,
                color: "var(--error)",
                cursor: "pointer",
              }}
            >
              <TrashIcon width={12} height={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Tabs */}
      <div style={tabBarStyle}>
        {([
          { id: "overview", label: t("Overview") },
          { id: "runs",     label: `${t("Runs history")}${runs.length > 0 ? ` (${runs.length})` : ""}` },
          { id: "prompt",   label: t("Prompt") },
          { id: "config",   label: t("Config") },
        ] as const).map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)} style={tabItemStyle(tab === item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
        {tab === "overview" && <TaskOverviewTab task={task} runs={runs} channelMeta={channelMeta} modelIcons={modelIcons} />}
        {tab === "runs" && (
          <TaskRunsTab
            runs={runs}
            loading={runsLoading}
            filter={runFilter}
            onFilterChange={setRunFilter}
            triggering={triggering}
            onTrigger={() => void onTrigger(task)}
            onOpenSession={onOpenSession}
          />
        )}
        {tab === "prompt" && <TaskPromptTab task={task} />}
        {tab === "config" && <TaskConfigTab task={task} modelIcons={modelIcons} channelMeta={channelMeta} onEdit={() => onEdit(task)} />}
      </div>
    </div>
  );
}