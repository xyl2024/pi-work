/**
 * KanbanPanel — the right-bar board for orchestrating a stream of tasks.
 *
 * Top status bar shows the global in-progress / to-review tallies plus a
 * "New task" action. Below it four columns (Backlog / In Progress /
 * Review & Test / Done) hold task cards. Cards move:
 *   - automatically (Run on a backlog card -> in_progress; a finished run
 *     -> review_test),
 *   - manually by dragging between any columns, or via per-card buttons.
 *
 * Running cards are created as detached background pi sessions — tapping
 * "Open session" mounts that session into the workspace as a real chat tab
 * so the user can inspect or continue it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { useKanban } from "@/hooks/useKanban";
import { useCwdAlias, useCwdAliases } from "@/hooks/cwdAliasStore";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { ProviderIcon, ProviderGearIcon, resolveProviderIcon } from "@/components/ui/ProviderIcon";
import { KanbanTaskModal } from "./KanbanTaskModal";
import { Play, ExternalLink, Plus, Pencil, Trash2, Loader2, CircleStop, Wrench, Folder, Clock, Search, X, MessagesSquare, FileDiff, ChevronRight } from "lucide-react";
import type { KanbanStatus, KanbanTask, KanbanTaskStats, KanbanContextUsage } from "@/lib/shared/kanban-types";
import { KANBAN_STATUS_ORDER } from "@/lib/shared/kanban-types";
import type { ToolInfo } from "@/lib/shared/types";

interface KanbanPanelProps {
  defaultCwd: string | null;
  defaultModel: { provider: string; modelId: string } | null;
  defaultThinkingLevel: string;
  defaultTools: ToolInfo[];
  onOpenSession: (sessionId: string) => void;
  /** True when the right panel is full-width (expanded). The header row with
   *  counts / cwd filter / New task is only shown in the expanded state. */
  expanded: boolean;
}

type ColumnMeta = {
  status: KanbanStatus;
  accent: string;
};

const COLUMNS: ColumnMeta[] = [
  { status: "backlog", accent: "#94a3b8" },
  { status: "in_progress", accent: "#3b82f6" },
  { status: "review_test", accent: "#f59e0b" },
  { status: "done", accent: "#22c55e" },
];

/** Solid palette for the per-level dot (mirrors ChatInput's thinking colors). */
const THINKING_COLOR: Record<string, string> = {
  off: "#94a3b8",
  minimal: "#38bdf8",
  low: "#3b82f6",
  medium: "#8b5cf6",
  high: "#f97316",
  xhigh: "#ef4444",
  max: "#b91c1c",
};

function toolNamesLabel(toolNames: KanbanTask["toolNames"]): string {
  if (toolNames === "all" || toolNames === null) return "all";
  if (toolNames.length === 0) return "off";
  return toolNames.length <= 3
    ? toolNames.join(", ")
    : `${toolNames.length} tools`;
}

/** Short time label for a millisecond timestamp, e.g. "Dec 3, 14:05". */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Last path segment of a cwd, e.g. "/a/b/proj" -> "proj". */
function basename(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : cwd;
}

/** Whether a task passes the text filter. Matches the task name, user prompt,
 *  and cwd (full path, basename, or user-set alias) — all as case-insensitive
 *  substrings. */
function matchesTaskFilter(
  task: KanbanTask,
  filter: string,
  aliases: Record<string, string> | null,
): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  if (task.taskName && task.taskName.toLowerCase().includes(q)) return true;
  if (task.prompt.toLowerCase().includes(q)) return true;
  if (task.cwd.toLowerCase().includes(q)) return true;
  if (basename(task.cwd).toLowerCase().includes(q)) return true;
  const alias = aliases?.[task.cwd];
  if (alias && alias.toLowerCase().includes(q)) return true;
  return false;
}

export function KanbanPanel(props: KanbanPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const kanban = useKanban();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<KanbanTask | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<KanbanStatus | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const cwdAliases = useCwdAliases();

  // Provider icon map (<provider>:<modelId> → icon id) so cards can paint the
  // right model brand glyph. Loaded once per mount.
  const [modelIcons, setModelIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetch("/api/models", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { modelIcons?: Record<string, string> } | null) => {
        if (!cancelled && d?.modelIcons) setModelIcons(d.modelIcons);
      })
      .catch(() => {
        /* icons are optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Stable identity across the 5s poll re-renders (they rebuild props).
  // The task modal keys its form-reset on this object, so it must not be a
  // fresh literal every render or the user's in-progress input gets cleared.
  const taskDefaults = useMemo(
    () => ({
      cwd: props.defaultCwd,
      model: props.defaultModel,
      thinkingLevel: props.defaultThinkingLevel,
      toolNames: props.defaultTools,
    }),
    [props.defaultCwd, props.defaultModel, props.defaultThinkingLevel, props.defaultTools],
  );

  const byStatus = useMemo(() => {
    const map = new Map<KanbanStatus, KanbanTask[]>();
    for (const s of KANBAN_STATUS_ORDER) map.set(s, []);
    for (const task of kanban.tasks ?? []) {
      if (!matchesTaskFilter(task, query, cwdAliases.map)) continue;
      const list = map.get(task.status);
      if (list) list.push(task);
    }
    // 每一列内的卡片按创建时间倒序排列（最新任务在顶部）。
    for (const s of KANBAN_STATUS_ORDER) {
      const list = map.get(s);
      if (list) list.sort((a, b) => b.createdAt - a.createdAt);
    }
    return map;
  }, [kanban.tasks, query, cwdAliases]);

  // Global per-column tallies (unaffected by the filter) so the header
  // keeps showing the true board state while the columns are narrowed.
  const totalByStatus = useMemo(() => {
    const map = new Map<KanbanStatus, number>();
    for (const s of KANBAN_STATUS_ORDER) map.set(s, 0);
    for (const task of kanban.tasks ?? []) {
      map.set(task.status, (map.get(task.status) ?? 0) + 1);
    }
    return map;
  }, [kanban.tasks]);

  const toastFrom = (ok: boolean, okMsg: string, errMsg: string) => {
    if (ok) toast.show({ kind: "success", message: t(okMsg) });
    else toast.show({ kind: "error", message: t(errMsg) });
  };

  const handleCreate = async (taskId: string, opts?: { autoStart?: boolean }) => {
    await kanban.refresh();
    setModalOpen(false);
    // "Create & start": immediately run the fresh task so it lands in the
    // In Progress column and boots its pi session (same path as card Run).
    if (opts?.autoStart) {
      const ok = await kanban.start(taskId);
      toastFrom(ok, "Started task", "Failed to start task");
    }
  };

  const handleEditSaved = async (taskId: string) => {
    await kanban.refresh();
    setModalOpen(false);
    setEditingTask(null);
    void taskId;
  };

  const handleStart = async (task: KanbanTask) => {
    const ok = await kanban.start(task.id);
    toastFrom(ok, "Started task", "Failed to start task");
  };

  const handleStop = async (task: KanbanTask) => {
    const confirmed = await confirm({
      title: t("Stop this task?"),
      destructive: true,
      confirmLabel: t("Stop"),
    });
    if (!confirmed) return;
    const ok = await kanban.stop(task.id);
    if (!ok) toast.show({ kind: "error", message: t("Failed to stop task") });
  };

  const handleMoveToDone = async (task: KanbanTask) => {
    const ok = await kanban.move(task.id, { status: "done" });
    toastFrom(ok, "Moved to Done", "Failed to update task");
  };

  const handleDelete = async (task: KanbanTask) => {
    const confirmed = await confirm({
      title: t("Delete this task?"),
      description: t("Delete this task? This cannot be undone."),
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await kanban.remove(task.id);
    toastFrom(ok, "Task deleted", "Failed to update task");
  };

  // Native HTML5 drag-and-drop: dragging a card to a column moves it there.
  const handleDragStart = (task: KanbanTask) => (e: React.DragEvent) => {
    dragIdRef.current = task.id;
    setDraggingId(task.id);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", task.id);
    } catch {
      /* dataTransfer may be inaccessible; the ref still holds the id */
    }
  };

  const handleDragEnd = () => {
    dragIdRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  };

  const handleDrop = (status: KanbanStatus) => (e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    const id = dragIdRef.current ?? e.dataTransfer.getData("text/plain");
    if (!id) return;
    const task = (kanban.tasks ?? []).find((x) => x.id === id);
    if (!task || task.status === status) {
      handleDragEnd();
      return;
    }
    void kanban.move(id, { status }).then((ok) => {
      if (!ok) toast.show({ kind: "error", message: t("Failed to update task") });
    });
    handleDragEnd();
  };

  // Backlog cards are fixed in place — start them via the Run button so the
  // semi-automatic in_progress transition is the only way out. Everything else
  // (review_test / done) is draggable; other columns' cards can still be
  // dropped into Backlog as a manual send-back.
  const canDrag = (task: KanbanTask) =>
    task.status !== "in_progress" && task.status !== "backlog";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "transparent",
        color: "var(--text)",
        minHeight: 0,
      }}
    >
      {/* Top status bar — only rendered when the panel is expanded. */}
      {props.expanded && (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6" }} />
            {t("{count} in progress", { count: totalByStatus.get("in_progress") ?? 0 })}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />
            {t("{count} to review", { count: totalByStatus.get("review_test") ?? 0 })}
          </span>
        </div>
        {/* text filter — narrows columns by task name / prompt / cwd. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: "1 1 auto",
            minWidth: 0,
            maxWidth: 260,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "5px 8px",
          }}
        >
          <Search size={12} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Filter by name, prompt or cwd…")}
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "inherit",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label={t("Clear")}
              type="button"
              style={{
                display: "flex",
                alignItems: "center",
                border: "none",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={() => {
              setEditingTask(null);
              setModalOpen(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 12px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "var(--on-accent, #fff)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Plus size={13} />
            {t("New task")}
          </button>
        </div>
      </div>
      )}

      {/* Board — columns stay side-by-side, each stacked vertically. Columns
          have a comfortable min-width; when the panel is too narrow the board
          scrolls horizontally so a column is never squashed into a sliver. */}
      <div
        style={{
          flex: 1,
          display: "flex",
          gap: 10,
          padding: "0 10px 12px",
          overflowX: "auto",
          overflowY: "hidden",
          minHeight: 0,
          alignItems: "stretch",
        }}
      >
        {COLUMNS.map((col) => {
          const tasks = byStatus.get(col.status) ?? [];
          // Only review_test and done accept drops — those are the columns a
          // finished card may be dragged between. In Progress is entered solely
          // via the Run button on a Backlog card, and Backlog isn't a drag
          // target either (everything there is fixed in place).
          const droppable =
            col.status === "review_test" || col.status === "done";
          return (
            <div
              key={col.status}
              onDragOver={droppable ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTarget(col.status);
              } : undefined}
              onDragLeave={droppable ? (e) => {
                // Only clear when leaving the column element itself.
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDropTarget((cur) => (cur === col.status ? null : cur));
              } : undefined}
              onDrop={droppable ? handleDrop(col.status) : undefined}
              style={{
                // grow to fill when there's room, but never shrink below a
                // readable width — extra width overflows and scrolls.
                flex: "1 1 220px",
                minWidth: 220,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                borderRadius: 10,
                border: dropTarget === col.status
                  ? "1px dashed var(--accent)"
                  : "1px solid transparent",
                background: "var(--bg)",
              }}
            >
              {/* Column header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 12px",
                  flexShrink: 0,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.accent, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                  {t(statusLabelKey(col.status))}
                </span>
              </div>

              {/* Column body — cards stacked vertically, scrolls internally. */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "0 8px 8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  minHeight: 60,
                }}
              >
                {tasks.length === 0 && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "14px 4px", textAlign: "center" }}>
                    {t("No tasks in this column")}
                  </div>
                )}
                {tasks.map((task) => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    modelIcons={modelIcons}
                    dragging={draggingId === task.id}
                    onDragStart={canDrag(task) ? handleDragStart(task) : undefined}
                    onDragEnd={canDrag(task) ? handleDragEnd : undefined}
                    onRun={() => void handleStart(task)}
                    onMoveToDone={() => void handleMoveToDone(task)}
                    onStop={() => void handleStop(task)}
                    onEdit={() => {
                      setEditingTask(task);
                      setModalOpen(true);
                    }}
                    onDelete={() => void handleDelete(task)}
                    onOpenSession={
                      task.sessionId
                        ? () => props.onOpenSession(task.sessionId!)
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <KanbanTaskModal
          open={modalOpen}
          task={editingTask}
          defaults={taskDefaults}
          onClose={() => {
            setModalOpen(false);
            setEditingTask(null);
          }}
          onSaved={editingTask ? handleEditSaved : handleCreate}
          onToast={(kind, message) => toast.show({ kind, message })}
        />
      )}
    </div>
  );
}

function statusLabelKey(status: KanbanStatus): string {
  switch (status) {
    case "backlog":
      return "Backlog";
    case "in_progress":
      return "In Progress";
    case "review_test":
      return "Review & Test";
    case "done":
      return "Done";
  }
}

/** Short action button with the pi-work Tooltip attached (replaces the
 *  browser-default `title` attribute). The trigger stays a plain button so
 *  the flex layout and styling are untouched. */
function TooltipButton({
  tip,
  onClick,
  style,
  children,
}: {
  tip: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style: CSSProperties;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tip} side="top">
      <button type="button" onClick={onClick} style={style} aria-label={tip}>
        {children}
      </button>
    </Tooltip>
  );
}

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "10px 10px 8px",
  borderRadius: 9,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  cursor: "default",
};

function KanbanCard({
  task,
  modelIcons,
  dragging,
  onDragStart,
  onDragEnd,
  onRun,
  onMoveToDone,
  onStop,
  onEdit,
  onDelete,
  onOpenSession,
}: {
  task: KanbanTask;
  modelIcons: Record<string, string>;
  dragging: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onRun: () => void;
  onMoveToDone: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSession?: () => void;
}) {
  const { t } = useI18n();
  const cwdAlias = useCwdAlias(task.cwd);
  // Prefer the user-set alias; otherwise show only the basename of the cwd.
  const cwdLabel = cwdAlias || basename(task.cwd);
  // Toggle detail: clicking the task name collapses / expands the card body.
  // Cards start collapsed so a full board stays scannable.
  const [collapsed, setCollapsed] = useState(true);
  // Provider-brand icon for the model (falls back to a small gear glyph).
  const modelIconId = resolveProviderIcon(task.provider, task.modelId, modelIcons);

  // review_test and done both carry a finished run — show the prompt AND the
  // final assistant message together. backlog / in_progress show the prompt.
  const showResult = task.status === "review_test" || task.status === "done";
  const resultText = showResult
    ? task.error
      ? task.error
      : (task.resultSummary ?? null)
    : null;

  const actionButton: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 11,
  };

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{ ...cardStyle, opacity: dragging ? 0.4 : 1, cursor: "default" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <ChevronRight
          size={11}
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((v) => !v);
          }}
          aria-hidden
          style={{
            flexShrink: 0,
            cursor: "pointer",
            color: "var(--text-dim)",
            transform: collapsed ? "none" : "rotate(90deg)",
            transition: "transform 0.12s ease",
          }}
        />
        {task.taskName && (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? t("Expand") : t("Collapse")}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text)",
              background: "transparent",
              border: "none",
              padding: 0,
              textAlign: "left",
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
          >
            {task.taskName}
          </button>
        )}
      </div>

      {/* Run / stop / done / open-session footer toggles by status. For the
          non-backlog statuses the card body below sits between the name row
          and this row, so keep the buttons in their own row after the body. */}
      {collapsed && (
        <KanbanTaskStats stats={task.stats} usage={task.contextUsage} t={t} />
      )}

      {/* Main + meta body — hidden when the card is collapsed. */}
      {!collapsed && (
        <>
      {/* Main content: for review_test / done show both the user prompt and
          the final assistant message; otherwise just the prompt. */}
      {showResult ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div>
            <span
              style={{
                display: "block",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: "var(--text-dim)",
                marginBottom: 2,
              }}
            >
              {t("User prompt")}
            </span>
            <Tooltip content={task.prompt} side="top" delayDuration={0} maxWidth={360}>
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "var(--text)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {task.prompt}
              </div>
            </Tooltip>
          </div>
          {/* Divider between the prompt and the finished result. */}
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, paddingTop: 6 }}>
            <span
              style={{
                display: "block",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: task.error ? "var(--error)" : "var(--text-dim)",
                marginBottom: 2,
              }}
            >
              {task.error ? t("Error") : t("Result")}
            </span>
            <Tooltip
              content={resultText ?? t("No result")}
              side="top"
              delayDuration={0}
              maxWidth={360}
            >
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: task.error ? "var(--error)" : "var(--text)",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {resultText ?? t("No result")}
              </div>
            </Tooltip>
          </div>
        </div>
      ) : (
        <Tooltip content={task.prompt} side="top" delayDuration={0} maxWidth={360}>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.45,
              color: "var(--text)",
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {task.prompt}
          </div>
        </Tooltip>
      )}

      {/* Run stats for the linked session (messages / tools / files / lines). */}
      <KanbanTaskStats stats={task.stats} usage={task.contextUsage} t={t} />

      {/* Richer meta: model + thinking, tool set, cwd, timestamps. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          borderTop: "1px solid var(--border)",
          paddingTop: 6,
          marginTop: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-dim)", overflow: "hidden" }}>
          {task.modelId ? (
            <>
              <ProviderIcon
                id={modelIconId ?? ""}
                size={11}
                fallback={<ProviderGearIcon size={10} />}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {task.modelId}
              </span>
            </>
          ) : (
            <span style={{ opacity: 0.75 }}>{t("No model")}</span>
          )}
          {task.thinkingLevel && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", flexShrink: 0 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: THINKING_COLOR[task.thinkingLevel] ?? "#94a3b8",
                  flexShrink: 0,
                }}
              />
              {task.thinkingLevel}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-dim)", overflow: "hidden" }}>
          <Wrench size={10} style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>
            {toolNamesLabel(task.toolNames)}
          </span>
          <Folder size={10} style={{ flexShrink: 0, marginLeft: 4 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, direction: "rtl", textAlign: "left", flex: 1 }}>
            {cwdLabel}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-dim)" }}>
          <Clock size={10} style={{ flexShrink: 0 }} />
          <span>{formatTime(task.createdAt)}</span>
          {task.status === "in_progress" && task.startedAt && (
            <span style={{ marginLeft: "auto", color: "#3b82f6" }}>
              {t("Started")} {formatTime(task.startedAt)}
            </span>
          )}
          {task.status === "done" && task.endedAt && (
            <span style={{ marginLeft: "auto" }}>{t("Ended")} {formatTime(task.endedAt)}</span>
          )}
        </div>
      </div>
      </>
      )}

      {task.status === "backlog" && (
        <div style={{ display: "flex", gap: 4, marginTop: 2, alignItems: "center" }}>
          <TooltipButton
            tip={t("Start executing this task")}
            onClick={() => onRun()}
            style={{
              ...actionButton,
              background: "var(--accent)",
              color: "var(--on-accent, #fff)",
              borderColor: "transparent",
              fontWeight: 600,
            }}
          >
            <Play size={11} />
            {t("Run")}
          </TooltipButton>
          <TooltipButton tip={t("Edit")} onClick={() => onEdit()} style={actionButton}>
            <Pencil size={11} />
          </TooltipButton>
          <TooltipButton tip={t("Delete")} onClick={() => onDelete()} style={actionButton}>
            <Trash2 size={11} />
          </TooltipButton>
        </div>
      )}

      {task.status === "in_progress" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          <Loader2 size={12} style={{ flexShrink: 0, animation: "spin 1s linear infinite" }} />
          <span>{t("Running")}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {onOpenSession && (
              <TooltipButton tip={t("Open session")} onClick={() => onOpenSession()} style={actionButton}>
                <ExternalLink size={11} />
              </TooltipButton>
            )}
            <TooltipButton tip={t("Stop")} onClick={() => onStop()} style={{ ...actionButton, color: "var(--error)" }}>
              <CircleStop size={11} />
            </TooltipButton>
          </span>
        </div>
      )}

      {task.status === "review_test" && (
        <div style={{ display: "flex", gap: 4, marginTop: 2, alignItems: "center" }}>
          <TooltipButton tip={t("Move to Done")} onClick={() => onMoveToDone()} style={{ ...actionButton, color: "var(--text)", fontWeight: 600 }}>
            {t("Move to Done")}
          </TooltipButton>
          {onOpenSession && (
            <TooltipButton tip={t("Open session")} onClick={() => onOpenSession()} style={actionButton}>
              <ExternalLink size={11} />
            </TooltipButton>
          )}
          <TooltipButton tip={t("Edit")} onClick={() => onEdit()} style={actionButton}>
            <Pencil size={11} />
          </TooltipButton>
          <TooltipButton tip={t("Delete")} onClick={() => onDelete()} style={actionButton}>
            <Trash2 size={11} />
          </TooltipButton>
        </div>
      )}

      {task.status === "done" && (
        <div style={{ display: "flex", gap: 4, marginTop: 2, alignItems: "center" }}>
          {onOpenSession && (
            <TooltipButton tip={t("Open session")} onClick={() => onOpenSession()} style={actionButton}>
              <ExternalLink size={11} />
            </TooltipButton>
          )}
          <TooltipButton tip={t("Edit")} onClick={() => onEdit()} style={actionButton}>
            <Pencil size={11} />
          </TooltipButton>
          <TooltipButton tip={t("Delete")} onClick={() => onDelete()} style={actionButton}>
            <Trash2 size={11} />
          </TooltipButton>
        </div>
      )}
    </div>
  );
}

/** Compact context-window ring for a card — mirrors the chat top-bar
 *  `ContextUsageBar` (same five-tier palette, same SVG arc geometry) but
 *  sized for a 220px card and showing just the ring + percent. Returns null
 *  when the usage is unknown (no model window / no linked session). */
function CardContextRing({
  usage,
  t,
}: {
  usage: KanbanContextUsage | null;
  t: (key: string) => string;
}) {
  if (!usage?.contextWindow || usage.percent === null) return null;
  const pct = Math.max(0, Math.min(100, usage.percent));
  const color =
    pct > 80 ? "#ef4444" :
    pct > 60 ? "#f97316" :
    pct > 40 ? "#eab308" :
    pct > 20 ? "#22c55e" :
                "var(--accent)";
  const circumference = 2 * Math.PI * 5;
  const dashOffset = circumference * (1 - pct / 100);
  const ctxWindowFmt = usage.contextWindow >= 1_000_000
    ? `${(usage.contextWindow / 1_000_000).toFixed(1)}M`
    : usage.contextWindow >= 1000
      ? `${(usage.contextWindow / 1000).toFixed(0)}k`
      : String(usage.contextWindow);
  const label = `${t("Context")}: ${pct.toFixed(1)}% of ${usage.contextWindow.toLocaleString()} tokens`;

  return (
    <Tooltip content={label} side="top">
      <span
        aria-label={label}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 3,
          fontSize: 10,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color,
          cursor: "default",
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          style={{ flexShrink: 0, overflow: "visible" }}
        >
          <circle cx="6" cy="6" r="5" fill="none" stroke="var(--border)" strokeWidth="1.7" />
          <circle
            cx="6" cy="6" r="5"
            fill="none"
            stroke={color}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 6 6)"
            style={{ transition: "stroke-dashoffset 0.25s ease, stroke 0.2s ease" }}
          />
        </svg>
        <span>{pct.toFixed(0)}%</span>
        <span style={{ color: "var(--text-dim)", fontWeight: 500, fontSize: 9 }}>
          / {ctxWindowFmt}
        </span>
      </span>
    </Tooltip>
  );
}

/** Compact run-stats row shown on the card: message count, tool-call count,
 *  changed-file count, added/removed lines, and (right-aligned after the
 *  line delta) the session's context-window ring. Renders nothing when the
 *  task has no linked session / no computed stats yet (e.g. an idle backlog
 *  card). */
function KanbanTaskStats({
  stats,
  usage,
  t,
}: {
  stats: KanbanTaskStats | null;
  usage: KanbanContextUsage | null;
  t: (key: string) => string;
}) {
  if (!stats) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 10,
        color: "var(--text-dim)",
        flexWrap: "wrap",
        marginTop: 2,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <MessagesSquare size={10} style={{ flexShrink: 0 }} />
        <Tooltip content={t("Messages")} side="top">
          <span>{stats.messageCount}</span>
        </Tooltip>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Wrench size={10} style={{ flexShrink: 0 }} />
        <Tooltip content={t("Tool calls")} side="top">
          <span>{stats.toolCallCount}</span>
        </Tooltip>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <FileDiff size={10} style={{ flexShrink: 0 }} />
        <Tooltip content={t("Files changed")} side="top">
          <span>{stats.changedFileCount}</span>
        </Tooltip>
      </span>
      {stats.additions > 0 || stats.deletions > 0 ? (
        <span
          style={{
            marginLeft: "auto",
            flexShrink: 0,
            fontFamily: "var(--font-mono), monospace",
            display: "flex",
            gap: 4,
          }}
        >
          {stats.deletions > 0 && (
            <span style={{ color: "var(--deletion, #e5534b)" }}>−{stats.deletions}</span>
          )}
          {stats.additions > 0 && (
            <span style={{ color: "var(--addition, #3fb950)" }}>+{stats.additions}</span>
          )}
        </span>
      ) : null}
      {/* Session context-window ring — sits right of the line delta. */}
      <CardContextRing usage={usage} t={t} />
    </div>
  );
}