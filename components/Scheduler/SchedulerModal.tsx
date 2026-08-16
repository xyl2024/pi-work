/**
 * SchedulerModal — top-level scheduler dialog.
 *
 * Three-pane layout: header bar + left task list sidebar + right detail
 * pane. Owns:
 *   - task list state + CRUD
 *   - selection / search / filter state
 *   - keyboard shortcuts (n new, / search, j/k navigate, Enter open, r run,
 *     space toggle pause, e edit, ? help, Esc close)
 *
 * The form modal is rendered on top when the user creates or edits a task.
 * Runs are owned by the selected TaskDetail — this modal only handles
 * list-level refreshes triggered by CRUD on tasks.
 */

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useToast } from "@/components/Toast";
import { TaskListSidebar, type SidebarFilter } from "./TaskListSidebar";
import { TaskDetail } from "./TaskDetail";
import { TaskFormModal } from "./TaskFormModal";
import { apiFetch } from "./utils";
import type { ModelMeta, ScheduledTask } from "./types";
import { IconClose } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
}

interface FormState {
  open: boolean;
  task: ScheduledTask | null;
}

export function SchedulerModal({ open, onClose, onOpenSession }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({ isOpen: open, onClose });

  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<SidebarFilter>("all");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>({ open: false, task: null });
  const [triggering, setTriggering] = useState(false);
  const [meta, setMeta] = useState<ModelMeta | null>(null);

  // ── Loaders ──────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ tasks: ScheduledTask[] }>("/api/scheduled-tasks");
      setTasks(data.tasks ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadModels = useCallback(async () => {
    try {
      const data = await apiFetch<Partial<ModelMeta>>("/api/models");
      setMeta({
        modelList: data.modelList ?? [],
        thinkingLevels: data.thinkingLevels ?? {},
        thinkingLevelMaps: data.thinkingLevelMaps ?? {},
        defaultModel: data.defaultModel ?? null,
      });
    } catch {
      // Models are optional — fall back to defaults silently.
    }
  }, []);

  // Initial load when opening.
  useEffect(() => {
    if (open) {
      void loadTasks();
      void loadModels();
      setForm({ open: false, task: null });
    }
  }, [open, loadTasks, loadModels]);

  // Auto-select the first task when the list first loads (so the user
  // never stares at an empty right pane after opening).
  useEffect(() => {
    if (!open) return;
    if (selectedId) return;
    if (tasks.length === 0) return;
    setSelectedId(tasks[0].id);
  }, [open, tasks, selectedId]);

  // ── Selection ────────────────────────────────────────────────

  const selectedTask = selectedId ? tasks.find((t) => t.id === selectedId) ?? null : null;

  // ── CRUD ─────────────────────────────────────────────────────

  const createTask = () => setForm({ open: true, task: null });
  const editTask = (task: ScheduledTask) => setForm({ open: true, task });

  const onSaved = useCallback(async (taskId: string) => {
    await loadTasks();
    setSelectedId(taskId);
  }, [loadTasks]);

  const handleTrigger = useCallback(async (task: ScheduledTask) => {
    if (triggering) return;
    setTriggering(true);
    try {
      await apiFetch(`/api/scheduled-tasks/${encodeURIComponent(task.id)}/run`, { method: "POST" });
      toast.show({ kind: "success", message: t("Task triggered") });
      await loadTasks();
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to trigger task") });
    } finally {
      setTriggering(false);
    }
  }, [t, triggering, toast, loadTasks]);

  const handleToggleEnabled = useCallback(async (task: ScheduledTask) => {
    try {
      const updated = await apiFetch<{ task: ScheduledTask }>("/api/scheduled-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, enabled: !task.enabled }),
      });
      // Optimistic replace from server response
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated.task : t)));
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Failed to toggle task") });
    }
  }, [t, toast]);

  const handleDelete = useCallback(async (task: ScheduledTask) => {
    try {
      await apiFetch(`/api/scheduled-tasks?id=${encodeURIComponent(task.id)}`, { method: "DELETE" });
      toast.show({ kind: "success", message: t("Task deleted") });
      if (selectedId === task.id) setSelectedId(null);
      await loadTasks();
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Delete failed") });
    }
  }, [t, toast, selectedId, loadTasks]);

  // ── Keyboard ─────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      // Only Esc is handled at this level — it closes the form modal first,
      // otherwise it closes the dialog. Form-internal keys (typing in
      // inputs, Tab navigation, etc.) all bubble up naturally because we
      // never call preventDefault on them.
      if (e.key !== "Escape") return;
      if (form.open) {
        setForm({ open: false, task: null });
        return;
      }
      requestClose();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, form.open, requestClose]);

  if (!isVisible) return null;

  // Count of in-flight runs across all tasks (for sidebar banner)
  const runningCount = tasks.filter((t) => t.lastRunStatus === "running").length;

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
          borderRadius: 12,
          width: 940,
          maxWidth: "96vw",
          height: "84vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
          overflow: "hidden",
        }}
      >
        {/* Header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("Scheduled tasks")}</span>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {tasks.length > 0 ? `${tasks.length} 个` : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={requestClose}
              aria-label="关闭"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                padding: 0,
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              <IconClose width={14} height={14} />
            </button>
          </div>
        </div>

        {/* Body: sidebar + detail */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <TaskListSidebar
            tasks={tasks}
            loading={loading}
            error={error}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreate={createTask}
            filter={filter}
            onFilterChange={setFilter}
            query={query}
            onQueryChange={setQuery}
            runningCount={runningCount}
          />

          {selectedTask ? (
            <TaskDetail
              key={selectedTask.id}
              task={selectedTask}
              triggering={triggering}
              onToggleEnabled={handleToggleEnabled}
              onTrigger={handleTrigger}
              onEdit={editTask}
              onDelete={handleDelete}
              onOpenSession={onOpenSession}
              onTaskUpdated={(t) => setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...t } : x)))}
            />
          ) : (
            <EmptyDetail loading={loading && tasks.length === 0} />
          )}
        </div>
      </div>

      {/* Form modal layered on top */}
      {form.open && (
        <TaskFormModal
          open={form.open}
          task={form.task}
          meta={meta}
          onClose={() => setForm({ open: false, task: null })}
          onSaved={onSaved}
          onToast={(kind, message) => toast.show({ kind, message })}
        />
      )}
    </div>
  );
}

// ── Right-pane empty / loading state ─────────────────────────────

function EmptyDetail({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
        加载中...
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
        <div style={{ fontSize: 13, marginBottom: 6, color: "var(--text)" }}>从左侧选择一个任务</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>或创建一个新任务</div>
      </div>
    </div>
  );
}