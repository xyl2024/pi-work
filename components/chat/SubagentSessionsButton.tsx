"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { hasRunningSubagentTask, hasUnfinishedSubagentTask } from "@/lib/shared/subagent-task-duration";
import type { SubagentSessionStatsView, SubagentTaskSummary } from "@/lib/shared/types";
import { PopoverPortal, useDismissableLayer } from "@/components/ui/popover";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SubagentSessionsPopover } from "./subagent-sessions/SubagentSessionsPopover";

interface Props {
  parentSessionId: string | null;
  refreshKey: number;
  onOpenSession: (sessionId: string) => void;
  modelNames?: Record<string, string>;
  modelIcons?: Record<string, string>;
}

export function SubagentSessionsButton({
  parentSessionId,
  refreshKey,
  onOpenSession,
  modelNames,
  modelIcons,
}: Props) {
  const { t } = useI18n();
  const { show: showToast } = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<SubagentTaskSummary[]>([]);
  const [sessions, setSessions] = useState<SubagentSessionStatsView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [confirmingStopAll, setConfirmingStopAll] = useState(false);
  const loadedRef = useRef(false);
  const lastRefreshKeyRef = useRef(refreshKey);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const previousParentSessionIdRef = useRef<string | null>(null);

  const loadTasks = useCallback(async () => {
    if (!parentSessionId) return;
    if (!loadedRef.current) setLoading(true);
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(parentSessionId)}/subagents`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as {
        tasks?: SubagentTaskSummary[];
        sessions?: SubagentSessionStatsView[];
      };
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setError(false);
      loadedRef.current = true;
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [parentSessionId]);

  useEffect(() => {
    const sessionChanged = previousParentSessionIdRef.current !== parentSessionId;
    previousParentSessionIdRef.current = parentSessionId;

    if (sessionChanged) {
      setTasks([]);
      setSessions([]);
      setError(false);
      loadedRef.current = false;
      lastRefreshKeyRef.current = refreshKey;
      if (parentSessionId) void loadTasks();
      return;
    }

    if (lastRefreshKeyRef.current !== refreshKey) {
      lastRefreshKeyRef.current = refreshKey;
      if (parentSessionId) void loadTasks();
    }
  }, [loadTasks, parentSessionId, refreshKey]);

  const hasUnfinishedTask = hasUnfinishedSubagentTask(tasks);
  const hasRunningTask = hasRunningSubagentTask(tasks);

  useEffect(() => {
    if (!parentSessionId || (!hasUnfinishedTask && !open)) return;
    const timer = setInterval(() => {
      void loadTasks();
    }, 5_000);
    return () => clearInterval(timer);
  }, [hasUnfinishedTask, loadTasks, open, parentSessionId]);

  const handleDismiss = useCallback(() => {
    setOpen(false);
  }, []);

  useDismissableLayer({
    enabled: open && !confirmingStopAll,
    containerRef: rootRef,
    contentRef: popoverRef,
    triggerRef,
    onDismiss: handleDismiss,
  });

  const handleOpenSession = (sessionId: string) => {
    setOpen(false);
    onOpenSession(sessionId);
  };

  const handleStopAll = useCallback(async () => {
    if (!parentSessionId || stoppingAll || confirmingStopAll) return;
    setConfirmingStopAll(true);
    let confirmed = false;
    try {
      confirmed = await confirm({
        title: t("Stop all subagent tasks"),
        description: t("Stops every unfinished subagent task in this session, including queued tasks."),
        confirmLabel: t("Stop all"),
        destructive: true,
      });
    } finally {
      setConfirmingStopAll(false);
    }
    if (!confirmed) return;

    setStoppingAll(true);
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(parentSessionId)}/subagents/stop-all`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadTasks();
    } catch {
      showToast({ kind: "error", message: t("Failed to stop subagent tasks") });
    } finally {
      setStoppingAll(false);
    }
  }, [confirm, confirmingStopAll, loadTasks, parentSessionId, showToast, stoppingAll, t]);

  const label = t("SubAgent");
  const disabled = !parentSessionId;
  const running = hasRunningTask && !disabled;

  return (
    <div ref={rootRef} className="pointer-events-auto relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-subagent-running-pulse={running ? "" : undefined}
        className="flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100"
        style={{
          background: "var(--bg-panel)",
          borderColor: running
            ? "color-mix(in srgb, var(--accent) 55%, var(--border))"
            : "var(--border)",
          color: disabled ? "var(--text-dim)" : "var(--text-muted)",
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Bot size={16} strokeWidth={1.8} aria-hidden="true" />
        {tasks.length > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              transform: "translate(14px, -14px)",
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 9,
              background: "var(--accent)",
              color: "var(--bg)",
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 0 2px var(--bg-panel)",
            }}
          >
            {tasks.length > 99 ? "99+" : tasks.length}
          </span>
        )}
      </button>

      <PopoverPortal
        open={open && !disabled}
        triggerRef={triggerRef}
        popoverRef={popoverRef}
        align="end"
        gap={8}
        contentDeps={[tasks, sessions, loading, error, stoppingAll]}
        ariaLabel={t("Subagent sessions")}
        style={{
          width: 560,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "min(70vh, 640px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: 6,
          background: "var(--bg-panel)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 10px 28px rgba(0,0,0,0.28)",
        }}
      >
        <SubagentSessionsPopover
          tasks={tasks}
          sessions={sessions}
          loading={loading}
          error={error}
          stoppingAll={stoppingAll}
          onStopAll={() => void handleStopAll()}
          onOpenSession={handleOpenSession}
          modelNames={modelNames}
          modelIcons={modelIcons}
        />
      </PopoverPortal>
    </div>
  );
}
