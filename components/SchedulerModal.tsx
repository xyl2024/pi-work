"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmDialog";
import { Tooltip } from "./Tooltip";
import { ProviderIcon } from "./ProviderIcon";

type TaskRunStatus = "running" | "success" | "error" | "timeout";

interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  cwd: string;
  prompt: string;
  enabled: boolean;
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  toolNames: string[] | null;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastRunStatus: TaskRunStatus | null;
  unreadCount: number;
}

interface TaskRun {
  id: string;
  taskId: string;
  startedAt: number;
  endedAt: number | null;
  status: TaskRunStatus;
  replyText: string | null;
  error: string | null;
  sessionId: string | null;
  durationMs: number | null;
  readAt: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
}

interface ModelMeta {
  modelList: { id: string; name: string; provider: string }[];
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  defaultModel: { provider: string; modelId: string } | null;
}

type View =
  | { kind: "list" }
  | { kind: "runs"; taskId: string }
  | { kind: "form"; editingId: string | null };

type ToolMode = "all" | "none" | "custom";

interface TaskForm {
  name: string;
  cron: string;
  cwd: string;
  prompt: string;
  enabled: boolean;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  toolMode: ToolMode;
  toolNames: string;
}

const EMPTY_FORM: TaskForm = {
  name: "",
  cron: "",
  cwd: "",
  prompt: "",
  enabled: true,
  provider: "",
  modelId: "",
  thinkingLevel: "",
  toolMode: "all",
  toolNames: "",
};

// Mirrors the chat input bar's thinking picker (ChatInput.tsx): level →
// indicator color + per-level description, reused by the scheduler form.
const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const THINKING_LEVEL_COLOR: Record<(typeof THINKING_LEVELS)[number], string> = {
  auto: "var(--text-dim)",
  off: "#94a3b8",
  minimal: "#38bdf8",
  low: "#3b82f6",
  medium: "#8b5cf6",
  high: "#f97316",
  xhigh: "#ef4444",
};
const THINKING_DESC: Record<(typeof THINKING_LEVELS)[number], string> = {
  auto: "Use pi default",
  off: "Disable reasoning",
  minimal: "Minimal reasoning",
  low: "Low reasoning",
  medium: "Medium reasoning",
  high: "High reasoning",
  xhigh: "Highest reasoning",
};

function formatDateTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}

export function SchedulerModal({ open, onClose, onOpenSession }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({
    isOpen: open,
    onClose,
  });
  const [view, setView] = useState<View>({ kind: "list" });
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [modelMeta, setModelMeta] = useState<ModelMeta | null>(null);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models");
      if (!res.ok) return;
      const data = (await res.json()) as Partial<ModelMeta>;
      setModelMeta({
        modelList: data.modelList ?? [],
        thinkingLevels: data.thinkingLevels ?? {},
        thinkingLevelMaps: data.thinkingLevelMaps ?? {},
        defaultModel: data.defaultModel ?? null,
      });
    } catch {
      // Model metadata is an optional nicety — fall back to the default options silently.
    }
  }, []);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scheduled-tasks");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tasks?: ScheduledTask[] };
      setTasks(data.tasks ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (taskId: string) => {
    setRunsLoading(true);
    try {
      const res = await fetch(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/runs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { runs?: TaskRun[] };
      setRuns(data.runs ?? []);
    } catch {
      toast.show({ kind: "error", message: t("Failed to load runs") });
    } finally {
      setRunsLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    if (open) {
      void loadTasks();
      void loadModels();
      setView({ kind: "list" });
    } else {
      setView({ kind: "list" });
      setRuns([]);
      setForm({ ...EMPTY_FORM });
    }
  }, [open, loadTasks, loadModels]);

  useEffect(() => {
    if (open && view.kind === "runs") void loadRuns(view.taskId);
  }, [open, view, loadRuns]);

  // Auto-refresh runs while a run is in flight.
  useEffect(() => {
    const inFlight = runs.some((r) => r.status === "running");
    if (view.kind !== "runs" || !inFlight) return;
    const id = view.taskId;
    const timer = setInterval(() => { void loadRuns(id); }, 2000);
    return () => clearInterval(timer);
  }, [view, runs, loadRuns]);

  const openNewForm = () => {
    setForm({ ...EMPTY_FORM });
    setView({ kind: "form", editingId: null });
  };

  const openEditForm = (task: ScheduledTask) => {
    const toolNames = task.toolNames ?? [];
    setForm({
      name: task.name,
      cron: task.cron,
      cwd: task.cwd,
      prompt: task.prompt,
      enabled: task.enabled,
      provider: task.provider ?? "",
      modelId: task.modelId ?? "",
      thinkingLevel: task.thinkingLevel ?? "",
      toolMode: task.toolNames === null ? "all" : toolNames.length === 0 ? "none" : "custom",
      toolNames: toolNames.join(", "),
    });
    setView({ kind: "form", editingId: task.id });
  };

  const openRuns = (taskId: string) => {
    setView({ kind: "runs", taskId });
  };

  const cancelForm = () => {
    setView({ kind: "list" });
  };

  const saveForm = async () => {
    if (saving) return;
    const editingId = view.kind === "form" ? view.editingId : null;
    setSaving(true);
    const toolNamesArr = form.toolNames
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    let toolNames: string[] | null;
    if (form.toolMode === "all") toolNames = null;
    else if (form.toolMode === "none") toolNames = [];
    else toolNames = toolNamesArr.length > 0 ? toolNamesArr : null;
    const body = {
      name: form.name.trim(),
      cron: form.cron.trim(),
      cwd: form.cwd.trim(),
      prompt: form.prompt.trim(),
      enabled: form.enabled,
      provider: form.provider.trim() || null,
      modelId: form.modelId.trim() || null,
      thinkingLevel: form.thinkingLevel.trim() || null,
      toolNames,
    };
    try {
      let res: Response;
      if (editingId) {
        res = await fetch("/api/scheduled-tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...body }),
        });
      } else {
        res = await fetch("/api/scheduled-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.show({ kind: "success", message: editingId ? t("Task updated") : t("Task created") });
      setView({ kind: "list" });
      void loadTasks();
    } catch (e) {
      toast.show({
        kind: "error",
        message: editingId ? t("Failed to update task") + ": " + String(e) : t("Failed to create task") + ": " + String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (task: ScheduledTask) => {
    try {
      const res = await fetch("/api/scheduled-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, enabled: !task.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void loadTasks();
    } catch (e) {
      toast.show({ kind: "error", message: t("Failed to update task") + ": " + String(e) });
    }
  };

  const markAllRead = async (taskId: string) => {
    try {
      const res = await fetch(
        `/api/scheduled-tasks/${encodeURIComponent(taskId)}/runs/mark-all-read`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void loadRuns(taskId);
      void loadTasks();
    } catch (e) {
      toast.show({ kind: "error", message: t("Failed to update runs") + ": " + String(e) });
    }
  };

  const toggleRunRead = async (run: TaskRun) => {
    const nextRead = run.readAt === null;
    setRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, readAt: nextRead ? Date.now() : null } : r)));
    try {
      const res = await fetch(
        `/api/scheduled-tasks/runs/${encodeURIComponent(run.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read: nextRead }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void loadTasks();
    } catch (e) {
      setRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, readAt: run.readAt } : r)));
      toast.show({ kind: "error", message: t("Failed to update run") + ": " + String(e) });
    }
  };

  const deleteTask = async (id: string) => {
    const ok = await confirm({
      title: t("Delete task"),
      description: t("Delete task?"),
      confirmLabel: t("Delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/scheduled-tasks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.show({ kind: "success", message: t("Task deleted") });
      if (view.kind === "runs" && view.taskId === id) {
        setView({ kind: "list" });
        setRuns([]);
      }
      void loadTasks();
    } catch (e) {
      toast.show({ kind: "error", message: t("Failed to delete task") + ": " + String(e) });
    }
  };

  const triggerNow = async (task: ScheduledTask) => {
    if (triggering) return;
    setTriggering(task.id);
    try {
      const res = await fetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}/run`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.show({ kind: "success", message: t("Task triggered") });
      setView({ kind: "runs", taskId: task.id });
    } catch (e) {
      toast.show({ kind: "error", message: t("Failed to trigger task") + ": " + String(e) });
    } finally {
      setTriggering(null);
    }
  };

  const handleOpenSession = (sessionId: string) => {
    onOpenSession(sessionId);
    onClose();
  };

  if (!isVisible) return null;

  const runsTask = view.kind === "runs" ? tasks.find((t) => t.id === view.taskId) ?? null : null;

  return (
    <div
      style={backdropStyle}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        style={{
          ...panelStyle,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          width: 620,
          maxWidth: "94vw",
          height: "78vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {view.kind !== "list" && (
              <Tooltip content={t("Back")}>
                <button
                  onClick={() => setView({ kind: "list" })}
                  aria-label={t("Back")}
                  style={{
                    background: "none", border: "none", padding: "2px 4px",
                    color: "var(--text-muted)", cursor: "pointer",
                    display: "flex", alignItems: "center",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              </Tooltip>
            )}
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {view.kind === "form"
                ? (view.editingId ? t("Edit task") : t("New task"))
                : view.kind === "runs" && runsTask
                  ? `${t("Runs history")}: ${runsTask.name}`
                  : t("Scheduled tasks")}
            </span>
            {view.kind === "list" && tasks.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>({tasks.length})</span>
            )}
          </div>
          <button
            onClick={requestClose}
            aria-label={t("Close")}
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        {view.kind === "list" && (
          <ListBody
            tasks={tasks}
            loading={loading}
            error={error}
            onRefresh={() => void loadTasks()}
            onNew={openNewForm}
            onOpenRuns={openRuns}
            onToggleEnabled={(t) => void toggleEnabled(t)}
          />
        )}
        {view.kind === "runs" && runsTask && (
          <RunsBody
            task={runsTask}
            runs={runs}
            runsLoading={runsLoading}
            triggering={triggering}
            onTrigger={() => void triggerNow(runsTask)}
            onToggleEnabled={() => void toggleEnabled(runsTask)}
            onEdit={() => openEditForm(runsTask)}
            onDelete={() => void deleteTask(runsTask.id)}
            onMarkAllRead={() => void markAllRead(runsTask.id)}
            onToggleRunRead={(r) => void toggleRunRead(r)}
            onOpenSession={handleOpenSession}
          />
        )}
        {view.kind === "form" && (
          <FormBody
            form={form}
            setForm={setForm}
            saving={saving}
            onSave={() => void saveForm()}
            onCancel={cancelForm}
            meta={modelMeta}
          />
        )}
      </div>
    </div>
  );
}

function ListBody({
  tasks,
  loading,
  error,
  onRefresh,
  onNew,
  onOpenRuns,
  onToggleEnabled,
}: {
  tasks: ScheduledTask[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onNew: () => void;
  onOpenRuns: (id: string) => void;
  onToggleEnabled: (task: ScheduledTask) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div style={{ display: "flex", gap: 6, padding: "10px 14px", flexShrink: 0 }}>
        <button
          onClick={onNew}
          style={{
            flex: 1,
            padding: "6px 8px",
            background: "var(--accent)",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + {t("New task")}
        </button>
        <Tooltip content={t("Refresh")}>
          <button
            onClick={onRefresh}
            aria-label={t("Refresh")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, padding: 0,
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </Tooltip>
      </div>

      <div style={{ flex: 1, overflowY: "auto", borderTop: "1px solid var(--border)" }}>
        {loading && (
          <div style={{ padding: "14px", color: "var(--text-muted)", fontSize: 12 }}>{t("Loading...")}</div>
        )}
        {error && (
          <div style={{ padding: "14px", color: "#f87171", fontSize: 12 }}>{error}</div>
        )}
        {!loading && !error && tasks.length === 0 && (
          <div style={{ padding: "20px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
            {t("No scheduled tasks yet")}
          </div>
        )}
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => onOpenRuns(task.id)}
            title={t("View runs")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              cursor: "pointer",
              borderBottom: "1px solid var(--border)",
              background: "transparent",
              opacity: task.enabled ? 1 : 0.55,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: task.unreadCount > 0 ? 600 : 400,
                  }}
                >
                  {task.name}
                </span>
                {task.unreadCount > 0 && (
                  <span
                    aria-label={`${task.unreadCount} ${t("unread")}`}
                    title={`${task.unreadCount} ${t("unread")}`}
                    style={{
                      flexShrink: 0,
                      background: "#ef4444",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 9,
                      lineHeight: 1.4,
                      minWidth: 18,
                      textAlign: "center",
                    }}
                  >
                    {task.unreadCount > 99 ? "99+" : task.unreadCount}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  marginTop: 1,
                }}
                title={`${task.cron} — next: ${formatDateTime(task.nextRunAt)}`}
              >
                {task.cron} · {task.enabled ? `${t("Next run")} ${formatDateTime(task.nextRunAt)}` : t("disabled")}
              </div>
            </div>
            <span
              onClick={(e) => { e.stopPropagation(); onToggleEnabled(task); }}
              title={task.enabled ? t("Disable") : t("Enable")}
              aria-label={task.enabled ? t("Disable") : t("Enable")}
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: task.enabled ? "#4ade80" : "#f87171",
                flexShrink: 0,
                cursor: "pointer",
                boxShadow: task.enabled ? "0 0 4px rgba(74, 222, 128, 0.6)" : "0 0 4px rgba(248, 113, 113, 0.6)",
              }}
            />
          </div>
        ))}
      </div>
    </>
  );
}

function RunsBody({
  task,
  runs,
  runsLoading,
  triggering,
  onTrigger,
  onToggleEnabled,
  onEdit,
  onDelete,
  onMarkAllRead,
  onToggleRunRead,
  onOpenSession,
}: {
  task: ScheduledTask;
  runs: TaskRun[];
  runsLoading: boolean;
  triggering: string | null;
  onTrigger: () => void;
  onToggleEnabled: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMarkAllRead: () => void;
  onToggleRunRead: (run: TaskRun) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {task.cron} · {task.enabled ? `${t("Next run")} ${formatDateTime(task.nextRunAt)}` : t("disabled")}
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={task.enabled}
              onChange={(e) => { e.stopPropagation(); onToggleEnabled(); }}
            />
            <span style={{ fontSize: 11 }}>{task.enabled ? t("enabled") : t("disabled")}</span>
          </label>
          {runs.some((r) => r.readAt === null) && (
            <button
              onClick={onMarkAllRead}
              style={{
                display: "inline-block",
                marginTop: 4,
                marginLeft: 10,
                padding: "2px 8px",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text-muted)",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              {t("Mark all as read")}
            </button>
          )}
        </div>
        <Tooltip content={t("Run now")}>
          <button
            onClick={onTrigger}
            disabled={triggering === task.id}
            aria-label={t("Run now")}
            style={{
              padding: "4px 10px",
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              color: "var(--text-muted)",
              fontSize: 11,
              cursor: triggering === task.id ? "default" : "pointer",
              opacity: triggering === task.id ? 0.6 : 1,
            }}
          >
            {triggering === task.id ? t("Triggering...") : t("Run now")}
          </button>
        </Tooltip>
        <Tooltip content={t("Edit task")}>
          <button
            onClick={onEdit}
            aria-label={t("Edit task")}
            style={{
              width: 28, height: 28, padding: 0,
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
        </Tooltip>
        <Tooltip content={t("Delete task")}>
          <button
            onClick={onDelete}
            aria-label={t("Delete task")}
            style={{
              width: 28, height: 28, padding: 0,
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              color: "#ef4444",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </Tooltip>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {runsLoading && runs.length === 0 && (
          <div style={{ padding: "20px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>{t("Loading...")}</div>
        )}
        {!runsLoading && runs.length === 0 && (
          <div style={{ padding: "24px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
            {t("No runs yet")}
          </div>
        )}
        {runs.map((run) => {
          const isUnread = run.readAt === null;
          return (
            <div
              key={run.id}
              style={{
                padding: "8px 14px",
                borderBottom: "1px solid var(--border)",
                fontSize: 12,
                background: isUnread ? "rgba(37,99,235,0.04)" : "transparent",
                borderLeft: isUnread ? "2px solid var(--accent)" : "2px solid transparent",
                paddingLeft: isUnread ? 12 : 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--text-muted)", flex: 1, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  {formatDateTime(run.startedAt)}
                </span>
                {run.durationMs != null && (
                  <span style={{ color: "var(--text-dim)", fontSize: 10 }}>
                    {(run.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
                <Tooltip content={isUnread ? t("Mark as read") : t("Mark as unread")}>
                  <button
                    onClick={() => onToggleRunRead(run)}
                    aria-label={isUnread ? t("Mark as read") : t("Mark as unread")}
                    style={{
                      padding: "2px 8px",
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      color: isUnread ? "var(--accent)" : "var(--text-dim)",
                      fontSize: 10,
                      cursor: "pointer",
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
                        padding: "2px 10px",
                        background: "var(--bg-hover)",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        color: "var(--text-muted)",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      ↗
                    </button>
                  </Tooltip>
                )}
              </div>
              {run.error && (
                <div style={{ marginTop: 4, fontSize: 11, color: "#f87171", fontFamily: "var(--font-mono)" }}>
                  {run.error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function FormBody({
  form,
  setForm,
  saving,
  onSave,
  onCancel,
  meta,
}: {
  form: TaskForm;
  setForm: (f: TaskForm) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  meta: ModelMeta | null;
}) {
  const { t } = useI18n();
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label={t("Task name")}>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
      </Field>
      <Field label={t("Cron expression")} hint={t("Cron examples hint")}>
        <input
          value={form.cron}
          onChange={(e) => setForm({ ...form, cron: e.target.value })}
          placeholder="0 9 * * *"
          style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
        />
      </Field>
      <Field label={t("Working directory")}>
        <input
          value={form.cwd}
          onChange={(e) => setForm({ ...form, cwd: e.target.value })}
          placeholder="/path/to/project"
          style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
        />
      </Field>
      <Field label={t("Prompt")}>
        <textarea
          value={form.prompt}
          onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          rows={4}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono)" }}
        />
      </Field>

      {/* Model / thinking / tools — dropdown selectors mirroring the chat input bar */}
      <ModelSelect form={form} setForm={setForm} meta={meta} />
      <ThinkingSelect form={form} setForm={setForm} meta={meta} />
      <ToolsSelect form={form} setForm={setForm} />

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        {t("enabled")}
      </label>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            flex: 1, padding: "7px 0",
            background: "var(--accent)", border: "none", borderRadius: 6,
            color: "#fff", fontSize: 12, fontWeight: 600,
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {t("Save")}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{
            flex: 1, padding: "7px 0",
            background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 6,
            color: "var(--text-muted)", fontSize: 12,
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polyline points="1.5 5 4 7.5 8.5 2.5" />
    </svg>
  );
}

function optionButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "6px 10px",
    borderRadius: 5,
    background: active ? "var(--bg-selected)" : "none",
    border: "none",
    color: active ? "var(--text)" : "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left",
    fontWeight: active ? 600 : 400,
    whiteSpace: "nowrap",
  };
}

/**
 * A form-field dropdown that opens a fixed-position panel below the button
 * (flips upward when there is no room). The panel is a DOM child of the
 * trigger wrapper, so outside-click detection covers both; scrolling the
 * form closes it so the panel never detaches from its button.
 */
function FieldDropdown({
  trigger,
  children,
  panelWidth,
}: {
  trigger: (open: boolean, toggle: () => void) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  panelWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; upward: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", handler);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const btn = wrapRef.current?.querySelector("[data-dropdown-anchor]") as HTMLElement | null;
      if (btn) {
        const r = btn.getBoundingClientRect();
        const spaceBelow = window.innerHeight - r.bottom;
        const upward = spaceBelow < 320;
        setRect({
          top: upward ? Math.max(8, r.top - 300) : r.bottom + 4,
          left: r.left,
          width: r.width,
          upward,
        });
      }
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {trigger(open, toggle)}
      {open && rect && (
        <div
          style={{
            position: "fixed",
            top: rect.top,
            left: rect.left,
            minWidth: rect.width,
            width: panelWidth,
            maxHeight: Math.min(300, rect.upward ? rect.top - 8 : window.innerHeight - rect.top - 8),
            overflowY: "auto",
            zIndex: 1200,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
            padding: 4,
            boxSizing: "border-box",
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Field wrapper + trigger button for the model / thinking dropdowns. */
function FieldSelect({
  label,
  display,
  icon,
  panelWidth,
  children,
}: {
  label: string;
  display: React.ReactNode;
  icon?: React.ReactNode;
  panelWidth?: number;
  children: (close: () => void) => React.ReactNode;
}) {
  return (
    <Field label={label}>
      <FieldDropdown
        panelWidth={panelWidth}
        trigger={(open, toggle) => (
          <button
            data-dropdown-anchor
            onClick={toggle}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              ...inputStyle,
              cursor: "pointer",
              textAlign: "left",
              background: open ? "var(--bg-hover)" : "var(--bg)",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {icon}
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", color: "var(--text)" }}>
              {display}
            </span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      >
        {children}
      </FieldDropdown>
    </Field>
  );
}

function ModelSelect({
  form,
  setForm,
  meta,
}: {
  form: TaskForm;
  setForm: (f: TaskForm) => void;
  meta: ModelMeta | null;
}) {
  const { t } = useI18n();
  const options = meta?.modelList ?? [];
  const isDefault = !form.provider && !form.modelId;
  const current = options.find((o) => o.provider === form.provider && o.id === form.modelId);
  const groups: { provider: string; options: { id: string; name: string; provider: string }[] }[] = [];
  for (const opt of options) {
    const g = groups.find((x) => x.provider === opt.provider);
    if (g) g.options.push(opt);
    else groups.push({ provider: opt.provider, options: [opt] });
  }

  return (
    <FieldSelect
      label={t("Model")}
      icon={
        <ProviderIcon
          id={current?.provider ?? ""}
          size={12}
          fallback={
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <rect x="9" y="9" width="6" height="6" />
              <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
              <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
              <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
              <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
            </svg>
          }
        />
      }
      display={
        isDefault ? (
          <span style={{ color: "var(--text-dim)" }}>
            {t("Default model")}
            {meta?.defaultModel ? ` (${meta.defaultModel.modelId})` : ""}
          </span>
        ) : (
          current?.name ?? `${form.provider}/${form.modelId}`
        )
      }
      panelWidth={300}
    >
      {(close) => (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <button
            onClick={() => { setForm({ ...form, provider: "", modelId: "" }); close(); }}
            style={optionButtonStyle(isDefault)}
          >
            {isDefault ? <CheckIcon /> : <span style={{ width: 10, flexShrink: 0 }} />}
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{t("Default model")}</span>
            {meta?.defaultModel && (
              <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>
                {meta.defaultModel.modelId}
              </span>
            )}
          </button>
          {options.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("No models available")}</div>
          )}
          {groups.map((g, gi) => (
            <div key={g.provider}>
              <div
                style={{
                  padding: "6px 10px 3px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                }}
              >
                {g.provider}
              </div>
              {g.options.map((opt) => {
                const active = opt.provider === form.provider && opt.id === form.modelId;
                return (
                  <button
                    key={`${opt.provider}:${opt.id}`}
                    onClick={() => { setForm({ ...form, provider: opt.provider, modelId: opt.id }); close(); }}
                    style={optionButtonStyle(active)}
                  >
                    {active ? <CheckIcon /> : <span style={{ width: 10, flexShrink: 0 }} />}
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{opt.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </FieldSelect>
  );
}

function ThinkingSelect({
  form,
  setForm,
  meta,
}: {
  form: TaskForm;
  setForm: (f: TaskForm) => void;
  meta: ModelMeta | null;
}) {
  const { t } = useI18n();
  const key = form.provider && form.modelId ? `${form.provider}:${form.modelId}` : null;
  const available = key ? meta?.thinkingLevels[key] : undefined;
  const levelMap = key ? meta?.thinkingLevelMaps[key] : undefined;
  const current = (form.thinkingLevel || "auto") as (typeof THINKING_LEVELS)[number];
  const currentMapped = current !== "auto" && levelMap ? levelMap[current] : undefined;
  const currentDisplay = currentMapped != null && currentMapped !== current ? currentMapped : current;

  return (
    <FieldSelect
      label={t("Thinking level")}
      display={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: THINKING_LEVEL_COLOR[current], flexShrink: 0 }} />
          {current === "auto" ? t("Use pi default") : currentDisplay}
        </span>
      }
      panelWidth={280}
    >
      {(close) => (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {THINKING_LEVELS.filter((lvl) => {
            if (lvl === "auto") return true;
            if (!available) return true;
            return available.includes(lvl);
          }).map((lvl) => {
            const active = current === lvl;
            const mappedVal = lvl !== "auto" && levelMap ? levelMap[lvl] : undefined;
            const displayLabel = mappedVal != null && mappedVal !== lvl ? mappedVal : lvl;
            const showOriginal = mappedVal != null && mappedVal !== lvl;
            return (
              <button
                key={lvl}
                onClick={() => { setForm({ ...form, thinkingLevel: lvl === "auto" ? "" : lvl }); close(); }}
                style={optionButtonStyle(active)}
              >
                {active ? <CheckIcon /> : <span style={{ width: 10, flexShrink: 0 }} />}
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: THINKING_LEVEL_COLOR[lvl], flexShrink: 0 }} />
                <span style={{ flex: 1 }}>
                  {displayLabel}
                  {showOriginal && (
                    <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({lvl})</span>
                  )}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t(THINKING_DESC[lvl])}</span>
              </button>
            );
          })}
        </div>
      )}
    </FieldSelect>
  );
}

function ToolsSelect({ form, setForm }: { form: TaskForm; setForm: (f: TaskForm) => void }) {
  const { t } = useI18n();
  const modes: { id: ToolMode; label: string; desc: string }[] = [
    { id: "all", label: t("All tools"), desc: t("All available tools") },
    { id: "none", label: t("No tools"), desc: t("No tools, chat only") },
    { id: "custom", label: t("Custom tools"), desc: "" },
  ];
  return (
    <Field label={t("Tools")}>
      <FieldDropdown
        panelWidth={300}
        trigger={(open, toggle) => (
          <button
            data-dropdown-anchor
            onClick={toggle}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              ...inputStyle,
              cursor: "pointer",
              textAlign: "left",
              background: open ? "var(--bg-hover)" : "var(--bg)",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
              {form.toolMode === "all"
                ? t("All tools")
                : form.toolMode === "none"
                  ? t("No tools")
                  : form.toolNames.trim()
                    ? form.toolNames
                    : t("Custom tools")}
            </span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      >
        {(close) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {modes.map((m) => {
              const active = form.toolMode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => { setForm({ ...form, toolMode: m.id }); if (m.id !== "custom") close(); }}
                  style={optionButtonStyle(active)}
                >
                  {active ? <CheckIcon /> : <span style={{ width: 10, flexShrink: 0 }} />}
                  <span style={{ flex: 1 }}>{m.label}</span>
                  {m.desc && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{m.desc}</span>}
                </button>
              );
            })}
            {form.toolMode === "custom" && (
              <div style={{ padding: "6px 8px 8px", borderTop: "1px solid var(--border)", marginTop: 4 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{t("Comma-separated tool names")}</div>
                <input
                  value={form.toolNames}
                  onChange={(e) => setForm({ ...form, toolNames: e.target.value })}
                  placeholder="bash, file_write, agent_todo"
                  style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
                />
              </div>
            )}
          </div>
        )}
      </FieldDropdown>
    </Field>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 12,
  padding: "5px 8px",
  border: "1px solid var(--border)",
  borderRadius: 5,
  outline: "none",
  background: "var(--bg)",
  color: "var(--text)",
  boxSizing: "border-box",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}