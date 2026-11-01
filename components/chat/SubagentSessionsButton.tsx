"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { isSubagentTerminalStatus, type SubagentTaskSummary } from "@/lib/shared/types";
import { SUBAGENT_STATUS_COLORS, SUBAGENT_STATUS_LABEL_KEYS } from "@/lib/shared/subagent-status";
import { GrokBot } from "@/components/grokbot/GrokBot";
import { findSubagentProfile, useSubagentProfiles } from "@/lib/client/subagent-profiles-store";
import { PopoverPortal, useDismissableLayer } from "@/components/ui/popover";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Props {
  parentSessionId: string | null;
  refreshKey: number;
  onOpenSession: (sessionId: string) => void;
}

export function SubagentSessionsButton({ parentSessionId, refreshKey, onOpenSession }: Props) {
  const { t } = useI18n();
  const { show: showToast } = useToast();
  const confirm = useConfirm();
  const profiles = useSubagentProfiles();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<SubagentTaskSummary[]>([]);
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

  const hasUnfinishedTask = tasks.some((task) => !isSubagentTerminalStatus(task.status));

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

      <PopoverPortal
        open={open && !disabled}
        triggerRef={triggerRef}
        popoverRef={popoverRef}
        align="end"
        gap={8}
        contentDeps={[tasks, loading, error, stoppingAll]}
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
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "5px 8px 7px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
            {t("Subagent sessions")}
          </span>
          {hasUnfinishedTask && (
            <button
              type="button"
              onClick={() => void handleStopAll()}
              disabled={stoppingAll}
              title={t("Stop all subagent tasks")}
              style={{
                flexShrink: 0,
                padding: "2px 8px",
                border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: 4,
                background: "transparent",
                color: stoppingAll ? "var(--text-dim)" : "#ef4444",
                font: "inherit",
                fontSize: 10,
                fontWeight: 600,
                lineHeight: 1.6,
                cursor: stoppingAll ? "default" : "pointer",
              }}
            >
              {stoppingAll ? t("Stopping") : t("Stop all")}
            </button>
          )}
        </div>
        <div style={{ minHeight: 0, overflowY: "auto", padding: "0 2px 2px" }}>
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
              const childSessionId = task.childSessionId;
              const statusColor = SUBAGENT_STATUS_COLORS[task.status];
              const botProfile = findSubagentProfile(profiles, task.subagentName);
              const hasStats = task.assistantCount != null && task.readCount != null;
              const stats = hasStats
                ? `${t("{count} messages", { count: task.assistantCount as number })} · ${t("read {count} files", { count: task.readCount as number })}`
                : null;
              return (
                <div
                  key={task.taskId}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    width: "100%",
                    padding: "7px 8px",
                    borderRadius: 5,
                    color: "var(--text)",
                    opacity: childSessionId ? 1 : 0.72,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ flexShrink: 0, width: 30, marginTop: -4 }}
                  >
                    {botProfile
                      ? <GrokBot appearance={botProfile.bot} size={30} interactive={false} />
                      : <span style={{ display: "inline-block", width: 7, height: 7, marginTop: 4, borderRadius: "50%", background: statusColor }} />}
                  </span>

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
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 2,
                        fontSize: 10,
                        lineHeight: 1.3,
                      }}
                    >
                      <span style={{ color: statusColor }}>{t(SUBAGENT_STATUS_LABEL_KEYS[task.status])}</span>
                      <span aria-hidden="true" style={{ color: "var(--text-dim)" }}>·</span>
                      <span style={{ color: "var(--text-dim)" }}>
                        {task.subagentName || t("SubAgent")}
                      </span>
                      {task.origin === "manual" && (
                        <>
                          <span aria-hidden="true" style={{ color: "var(--text-dim)" }}>·</span>
                          <span style={{ color: "var(--text-muted)" }}>{t("Manual")}</span>
                        </>
                      )}
                    </span>
                    {stats && (
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 3,
                          color: "var(--text-dim)",
                          fontSize: 10,
                          lineHeight: 1.3,
                        }}
                      >
                        {task.model && (
                          <span
                            style={{
                              flexShrink: 0,
                              maxWidth: 110,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {task.model}
                          </span>
                        )}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {stats}
                        </span>
                      </span>
                    )}
                  </span>

                  {childSessionId && (
                    <button
                      type="button"
                      onClick={() => handleOpenSession(childSessionId)}
                      aria-label={t("Open subagent session")}
                      title={t("Open subagent session")}
                      style={{
                        flexShrink: 0,
                        alignSelf: "center",
                        padding: "3px 8px",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        background: "transparent",
                        color: "var(--accent)",
                        font: "inherit",
                        fontSize: 10,
                        fontWeight: 600,
                        lineHeight: 1.6,
                        cursor: "pointer",
                      }}
                    >
                      {t("Open session")}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </PopoverPortal>
    </div>
  );
}
