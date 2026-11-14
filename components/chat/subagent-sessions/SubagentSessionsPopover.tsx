"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { type SubagentSessionStatsView, type SubagentTaskSummary } from "@/lib/shared/types";
import { projectSubagentSessionGroups } from "@/lib/shared/subagent-sessions";
import { hasUnfinishedSubagentTask } from "@/lib/shared/subagent-task-duration";
import { SubagentSessionGroupCard } from "./SubagentSessionGroupCard";

interface Props {
  tasks: SubagentTaskSummary[];
  sessions: SubagentSessionStatsView[];
  loading: boolean;
  error: boolean;
  stoppingAll: boolean;
  onStopAll: () => void;
  onOpenSession: (sessionId: string) => void;
  modelNames?: Record<string, string>;
  modelIcons?: Record<string, string>;
}

export function SubagentSessionsPopover({
  tasks,
  sessions,
  loading,
  error,
  stoppingAll,
  onStopAll,
  onOpenSession,
  modelNames,
  modelIcons,
}: Props) {
  const { t } = useI18n();
  const projection = useMemo(
    () => projectSubagentSessionGroups(tasks, sessions),
    [tasks, sessions],
  );
  const hasUnfinishedTask = hasUnfinishedSubagentTask(tasks);

  return (
    <>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "5px 8px 7px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
          {t("Subagent sessions")}
        </span>
        {hasUnfinishedTask && (
          <button
            type="button"
            onClick={onStopAll}
            disabled={stoppingAll}
            title={t("Stop all subagent tasks")}
            style={{
              flexShrink: 0,
              padding: "2px 8px",
              border: "1px solid color-mix(in srgb, var(--error) 35%, transparent)",
              borderRadius: "var(--radius-xs)",
              background: "transparent",
              color: stoppingAll ? "var(--text-dim)" : "var(--error)",
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
        ) : projection.groups.length === 0 ? (
          <div style={{ padding: "12px 8px", color: "var(--text-dim)", fontSize: 11 }}>
            {t("No subagent sessions")}
          </div>
        ) : (
          projection.groups.map((group, index) => (
            <div
              key={group.latestTask.taskId}
              style={index === 0 ? undefined : { borderTop: "1px solid var(--border)" }}
            >
              <SubagentSessionGroupCard
                group={group}
                onOpenSession={onOpenSession}
                modelNames={modelNames}
                modelIcons={modelIcons}
              />
            </div>
          ))
        )}
      </div>
    </>
  );
}
