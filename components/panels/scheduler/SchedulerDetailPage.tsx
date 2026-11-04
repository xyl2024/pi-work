"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { CollapsiblePanel } from "@/components/ui/CollapsiblePanel";
import { StatusBadge } from "@/components/scheduler/StatusBadge";
import { CronHumanizer } from "@/components/scheduler/CronHumanizer";
import { TaskRunsTab, type RunFilter } from "@/components/scheduler/TaskRunsTab";
import { TaskPromptTab } from "@/components/scheduler/TaskPromptTab";
import { isOnceDone, formatRelative } from "@/components/scheduler/utils";
import { useNow } from "@/components/scheduler/useNow";
import { fetchTaskRuns, fetchWechatChannels } from "@/lib/client/scheduler-io";
import { schedulerPollDelayMs } from "@/lib/shared/scheduler-cadence";
import { resolveSchedulerRunSelection } from "@/lib/shared/scheduler-runs";
import {
  openSchedulerForm,
  removeSchedulerTask,
  schedulerPanel,
  setSchedulerRunSelected,
  setSchedulerRunsVisible,
  toggleSchedulerTask,
  triggerSchedulerTaskNow,
  useSchedulerPanel,
} from "@/lib/client/scheduler-panel";
import {
  SCHEDULER_DETAIL_SECTION_DEFAULT_OPEN,
  type SchedulerDetailSection,
} from "@/lib/shared/scheduler-detail";
import type { TaskRun } from "@/lib/shared/scheduler";
import { ChevronDownIcon, EditIcon, PlayIcon, TrashIcon } from "@/components/ui/icons";
import { SchedulerExecutionConfig } from "./SchedulerExecutionConfig";

interface ChannelMeta {
  [channelId: string]: { name: string; status: string };
}

export function SchedulerDetailPage({
  taskId,
  onOpenSession,
}: {
  taskId: string;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { view } = useSchedulerPanel();
  const { tasks, meta, triggering, selectedRunId } = view;
  const task = tasks.find((item) => item.id === taskId) ?? null;
  const now = useNow(30_000);

  const [openSections, setOpenSections] = useState<Record<SchedulerDetailSection, boolean>>(
    SCHEDULER_DETAIL_SECTION_DEFAULT_OPEN,
  );
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  const [channelMeta, setChannelMeta] = useState<ChannelMeta | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const next = await fetchTaskRuns(taskId);
      if (schedulerPanel.get().selectedTaskId !== taskId) return;
      setRuns(next);
      const resolved = resolveSchedulerRunSelection(next, schedulerPanel.get().selectedRunId);
      if (resolved !== schedulerPanel.get().selectedRunId) setSchedulerRunSelected(resolved);
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to load runs") });
    } finally {
      setRunsLoading(false);
    }
  }, [taskId, toast, t]);

  useEffect(() => {
    setRuns([]);
    setRunFilter("all");
    void loadRuns();
  }, [taskId, loadRuns]);

  useEffect(() => {
    setSchedulerRunsVisible(true);
    return () => setSchedulerRunsVisible(false);
  }, []);

  useEffect(() => {
    const delay = schedulerPollDelayMs({
      runsVisible: runs.some((run) => run.status === "running"),
      hidden: typeof document !== "undefined" && document.hidden,
    });
    if (delay === null) return;
    const timer = setTimeout(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void loadRuns();
    }, delay);
    return () => clearTimeout(timer);
  }, [runs, loadRuns]);

  useEffect(() => {
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) void loadRuns();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadRuns]);

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
      <div
        style={{
          display: "flex",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          fontSize: 12,
        }}
      >
        {t("Task not found")}
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
      if (!triggered) return;
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

  const toggleSection = (section: SchedulerDetailSection) => {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={summaryStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <h2 style={titleStyle}>{task.name}</h2>
          <StatusBadge status={isOnceDone(task) ? "done" : task.enabled ? "enabled" : "paused"} size="md" />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <ToggleSwitch on={task.enabled} onChange={(next) => void handleToggle(next)} size="sm" label={t("Enabled")} />
            <button type="button" onClick={() => void openSchedulerForm(task, null)} style={actionButtonStyle}>
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

        <div style={{ display: "flex", alignItems: "center", gap: 20, rowGap: 6, flexWrap: "wrap", minWidth: 0 }}>
          <CronHumanizer cron={task.cron} previewCount={5} showCode timezone={task.timezone} />
          <SummaryMeta label={t("Next run")}>
            {task.enabled
              ? task.nextRunAt
                ? formatRelative(now, task.nextRunAt, locale)
                : "—"
              : t("Paused, will not trigger")}
          </SummaryMeta>
          <SummaryMeta label={t("Last run")}>
            {task.lastRunAt ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {formatRelative(now, task.lastRunAt, locale)}
                {task.lastRunStatus && <StatusBadge status={task.lastRunStatus} size="sm" />}
              </span>
            ) : (
              t("Never run")
            )}
          </SummaryMeta>
        </div>
      </div>

      <div style={disclosureRegionStyle}>
        <Disclosure
          label={t("Prompt")}
          open={openSections.prompt}
          onToggle={() => toggleSection("prompt")}
        >
          <TaskPromptTab task={task} />
        </Disclosure>
        <Disclosure
          label={t("Execution config")}
          open={openSections.config}
          onToggle={() => toggleSection("config")}
        >
          <SchedulerExecutionConfig
            task={task}
            channelMeta={channelMeta}
            modelIcons={meta?.modelIcons}
            modelIconPreferences={meta?.modelIconPreferences}
          />
        </Disclosure>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "10px 18px 14px" }}>
        <TaskRunsTab
          runs={runs}
          loading={runsLoading}
          filter={runFilter}
          onFilterChange={setRunFilter}
          selectedRunId={selectedRunId}
          onSelectRun={setSchedulerRunSelected}
          onOpenSession={onOpenSession}
        />
      </div>
    </div>
  );
}

function SummaryMeta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 12, color: "var(--text)" }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      <span>{children}</span>
    </span>
  );
}

function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={disclosureButtonStyle}>
        <ChevronDownIcon
          width={12}
          height={12}
          aria-hidden="true"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }}
        />
        {label}
      </button>
      <CollapsiblePanel open={open}>
        <div style={{ padding: "0 18px 12px" }}>{children}</div>
      </CollapsiblePanel>
    </div>
  );
}

const summaryStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 7,
  padding: "13px 18px 11px",
  borderBottom: "1px solid var(--border)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 700,
  color: "var(--text)",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const disclosureRegionStyle: CSSProperties = {
  flexShrink: 0,
  maxHeight: "40%",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  padding: "4px 0",
};

const disclosureButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 18px",
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
};

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
