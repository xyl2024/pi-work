"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/ui/Tooltip";
import type { SubagentTaskStatus, SubagentTaskSummary } from "@/lib/shared/types";

interface Props {
  parentSessionId: string | null;
  /** Incremented by the parent session's spawn_subagent event stream. */
  refreshKey: number;
  onOpenSession: (sessionId: string) => void;
}

const STATUS_KEYS: Record<SubagentTaskStatus, string> = {
  creating: "Creating",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<SubagentTaskStatus, string> = {
  creating: "#eab308",
  running: "var(--accent)",
  completed: "#22c55e",
  failed: "#ef4444",
  cancelled: "var(--text-dim)",
};

export function SubagentSessionsButton({ parentSessionId, refreshKey, onOpenSession }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<SubagentTaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loadedRef = useRef(false);
  const lastRefreshKeyRef = useRef(refreshKey);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const previousParentSessionIdRef = useRef<string | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 150);
  }, [cancelClose]);

  const loadTasks = useCallback(async () => {
    if (!parentSessionId) return;
    if (!loadedRef.current) setLoading(true);
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(parentSessionId)}/subagents`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { tasks?: SubagentTaskSummary[] };
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setError(false);
      loadedRef.current = true;
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [parentSessionId]);

  // Load exactly once when this session becomes active. Subsequent loads are
  // driven by refreshKey, which the parent session increments for relevant
  // spawn_subagent SSE events; there is deliberately no fixed polling loop.
  // Refreshes also run while the popover is closed so its badge already
  // reflects background subagent activity.
  useEffect(() => {
    const sessionChanged = previousParentSessionIdRef.current !== parentSessionId;
    previousParentSessionIdRef.current = parentSessionId;

    if (sessionChanged) {
      setTasks([]);
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

  useEffect(() => () => {
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
  }, []);

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
      scheduleClose();
    }
  };

  const handleOpenSession = (sessionId: string) => {
    cancelClose();
    setOpen(false);
    onOpenSession(sessionId);
  };

  const label = t("SubAgent");
  const disabled = !parentSessionId;

  return (
    <div
      ref={rootRef}
      className="pointer-events-auto relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onFocus={() => {
        cancelClose();
        setOpen(true);
      }}
      onBlur={handleBlur}
    >
      <Tooltip content={label}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          aria-label={label}
          aria-expanded={open}
          className="flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100"
          style={{
            background: "var(--bg-panel)",
            borderColor: "var(--border)",
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
      </Tooltip>

      {open && !disabled && (
        <div
          role="dialog"
          aria-label={t("Subagent sessions")}
          onMouseEnter={cancelClose}
          style={{
            position: "absolute",
            right: 0,
            bottom: "calc(100% + 8px)",
            width: 310,
            maxWidth: "calc(100vw - 32px)",
            maxHeight: 360,
            overflowY: "auto",
            padding: 6,
            background: "var(--bg-panel)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 10px 28px rgba(0,0,0,0.28)",
            zIndex: 20,
          }}
        >
          <div style={{ padding: "5px 8px 7px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
            {t("Subagent sessions")}
          </div>
          {loading ? (
            <div style={{ padding: "12px 8px", color: "var(--text-dim)", fontSize: 11 }}>
              {t("Loading...")}
            </div>
          ) : error ? (
            <div style={{ padding: "12px 8px", color: "var(--error)", fontSize: 11 }}>
              {t("Failed to load subagent sessions")}
            </div>
          ) : tasks.length === 0 ? (
            <div style={{ padding: "12px 8px", color: "var(--text-dim)", fontSize: 11 }}>
              {t("No subagent sessions")}
            </div>
          ) : (
            tasks.map((task) => {
              const canOpen = Boolean(task.childSessionId);
              const statusColor = STATUS_COLORS[task.status];
              return (
                <button
                  key={task.taskId}
                  type="button"
                  disabled={!canOpen}
                  onClick={() => {
                    if (task.childSessionId) handleOpenSession(task.childSessionId);
                  }}
                  title={canOpen ? t("Open subagent session") : t(STATUS_KEYS[task.status])}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    width: "100%",
                    padding: "7px 8px",
                    border: "none",
                    borderRadius: 5,
                    background: "transparent",
                    color: "var(--text)",
                    textAlign: "left",
                    cursor: canOpen ? "pointer" : "default",
                    font: "inherit",
                    opacity: canOpen ? 1 : 0.72,
                  }}
                  onMouseEnter={(event) => {
                    if (canOpen) event.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ width: 7, height: 7, marginTop: 4, borderRadius: "50%", flexShrink: 0, background: statusColor }}
                  />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 12,
                        lineHeight: 1.4,
                      }}
                    >
                      {task.description}
                    </span>
                    <span style={{ display: "block", marginTop: 2, color: statusColor, fontSize: 10, lineHeight: 1.3 }}>
                      {t(STATUS_KEYS[task.status])}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
