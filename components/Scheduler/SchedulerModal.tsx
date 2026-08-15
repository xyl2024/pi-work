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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useToast } from "@/components/Toast";
import { TaskListSidebar, type SidebarFilter } from "./TaskListSidebar";
import { TaskDetail } from "./TaskDetail";
import { TaskFormModal } from "./TaskFormModal";
import { apiFetch } from "./utils";
import type { ModelMeta, ScheduledTask } from "./types";
import { IconClose, IconKeyboard, IconRefresh } from "./icons";

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
  const [helpOpen, setHelpOpen] = useState(false);

  const searchRef = useRef<(() => void) | null>(null);

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
      setHelpOpen(false);
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

  const visibleTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (filter === "enabled" && !task.enabled) return false;
      if (filter === "disabled" && task.enabled) return false;
      if (filter === "error" && task.lastRunStatus !== "error" && task.lastRunStatus !== "timeout") return false;
      if (q.length > 0) {
        const haystack = `${task.name} ${task.cron} ${task.prompt}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, filter, query]);

  const selectedTask = selectedId ? tasks.find((t) => t.id === selectedId) ?? null : null;

  const moveSelection = useCallback((dir: 1 | -1) => {
    if (visibleTasks.length === 0) return;
    const idx = visibleTasks.findIndex((t) => t.id === selectedId);
    let nextIdx: number;
    if (idx === -1) nextIdx = dir === 1 ? 0 : visibleTasks.length - 1;
    else nextIdx = (idx + dir + visibleTasks.length) % visibleTasks.length;
    setSelectedId(visibleTasks[nextIdx].id);
  }, [visibleTasks, selectedId]);

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
      // Ignore key events targeted at form inputs (search box, form fields)
      const target = e.target as HTMLElement | null;
      const inFormInput = !!target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );

      // Esc always closes (even from inputs)
      if (e.key === "Escape") {
        if (form.open) {
          setForm({ open: false, task: null });
          return;
        }
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        requestClose();
        return;
      }

      if (form.open) return;

      // "/" focuses search (always works, even from inputs)
      if (e.key === "/" && !inFormInput) {
        e.preventDefault();
        const searchEl = document.querySelector('[data-scheduler-search]') as HTMLInputElement | null;
        searchEl?.focus();
        return;
      }

      if (inFormInput) return;

      // Cmd+F focuses search even from inputs
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        const searchEl = document.querySelector('[data-scheduler-search]') as HTMLInputElement | null;
        searchEl?.focus();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        createTask();
        return;
      }

      if (e.key === "j") { e.preventDefault(); moveSelection(1); return; }
      if (e.key === "k") { e.preventDefault(); moveSelection(-1); return; }

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }

      if (!selectedTask) return;

      if (e.key === "Enter") {
        // Detail is already showing — no-op (Enter on row in sidebar already
        // selects). But if no task is selected, the first row is auto-selected.
        return;
      }

      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        void handleTrigger(selectedTask);
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        void handleToggleEnabled(selectedTask);
        return;
      }

      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        editTask(selectedTask);
        return;
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        void handleDelete(selectedTask);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, form.open, helpOpen, selectedTask, requestClose, handleTrigger, handleToggleEnabled, handleDelete, moveSelection]);

  // Expose a search focus function for sidebar to register
  useEffect(() => {
    searchRef.current = () => {
      const searchEl = document.querySelector('[data-scheduler-search]') as HTMLInputElement | null;
      searchEl?.focus();
    };
  }, []);

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
              onClick={() => setHelpOpen((v) => !v)}
              aria-label="键盘快捷键"
              title="键盘快捷键 (?)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                padding: 0,
                background: helpOpen ? "var(--bg-selected)" : "transparent",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: helpOpen ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              <IconKeyboard width={13} height={13} />
            </button>
            <button
              onClick={() => void loadTasks()}
              aria-label="刷新"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                padding: 0,
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              <IconRefresh width={12} height={12} />
            </button>
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
            onRefresh={() => void loadTasks()}
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

      {/* Help overlay */}
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
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
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>或创建一个新任务</div>
      </div>
    </div>
  );
}

// ── Help overlay ─────────────────────────────────────────────────

function HelpOverlay({ onClose }: { onClose: () => void }) {
  const shortcuts: { keys: string[]; desc: string }[] = [
    { keys: ["n"],         desc: "新建任务" },
    { keys: ["/"],         desc: "聚焦搜索" },
    { keys: ["⌘", "F"],    desc: "聚焦搜索" },
    { keys: ["j"],         desc: "下一项" },
    { keys: ["k"],         desc: "上一项" },
    { keys: ["r"],         desc: "立即运行当前任务" },
    { keys: ["Space"],     desc: "暂停 / 启用当前任务" },
    { keys: ["e"],         desc: "编辑当前任务" },
    { keys: ["⌫"],         desc: "删除当前任务" },
    { keys: ["?"],         desc: "显示 / 隐藏本面板" },
    { keys: ["Esc"],       desc: "关闭" },
  ];
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "20px 24px",
          minWidth: 320,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>
          键盘快捷键
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", fontSize: 12 }}>
          {shortcuts.map((s) => (
            <div key={s.desc} style={{ display: "contents" }}>
              <div style={{ display: "flex", gap: 3 }}>
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    style={{
                      display: "inline-block",
                      padding: "1px 7px",
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--text)",
                    }}
                  >
                    {k}
                  </kbd>
                ))}
              </div>
              <div style={{ color: "var(--text-muted)", alignSelf: "center" }}>{s.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, fontSize: 10, color: "var(--text-dim)", textAlign: "center" }}>
          按 ? 或 Esc 关闭
        </div>
      </div>
    </div>
  );
}