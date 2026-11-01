"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { findSubagentProfile, useSubagentProfiles } from "@/lib/client/subagent-profiles-store";
import type { SubagentSessionGroup } from "@/lib/shared/subagent-sessions";
import type { ModelIconPreferences } from "@/lib/shared/model-icon-match";
import { SubagentSessionHeader } from "./SubagentSessionHeader";
import { SubagentSessionMetrics } from "./SubagentSessionMetrics";
import { SubagentSessionContextRing } from "./SubagentSessionContextRing";
import { SubagentTaskRow } from "./SubagentTaskRow";

interface Props {
  group: SubagentSessionGroup;
  onOpenSession: (sessionId: string) => void;
  modelNames?: Record<string, string>;
  modelIcons?: Record<string, string>;
  modelIconPreferences?: ModelIconPreferences;
}

export function SubagentSessionGroupCard({
  group,
  onOpenSession,
  modelNames,
  modelIcons,
  modelIconPreferences,
}: Props) {
  const { t } = useI18n();
  const profiles = useSubagentProfiles();
  const [historyOpen, setHistoryOpen] = useState(false);
  const profile = findSubagentProfile(profiles, group.latestTask.subagentName);
  const childSessionId = group.latestTask.childSessionId;
  const historyCount = group.historyTasks.length;

  return (
    <div style={{ padding: "9px 8px 8px" }}>
      <SubagentSessionHeader
        childSessionId={childSessionId}
        profileName={profile?.name ?? group.latestTask.subagentName}
        bot={profile?.bot ?? null}
        title={group.stats?.title ?? null}
        status={group.latestTask.status}
        onOpenSession={onOpenSession}
      />
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "2px 10px",
          marginTop: 6,
          fontSize: 10,
          lineHeight: 1.6,
          color: "var(--text-muted)",
        }}
      >
        <SubagentSessionMetrics
          stats={group.stats}
          modelNames={modelNames}
          modelIcons={modelIcons}
          modelIconPreferences={modelIconPreferences}
        />
        <SubagentSessionContextRing context={group.stats?.context ?? null} />
      </div>
      <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 2 }}>
        <SubagentTaskRow task={group.latestTask} />
        {historyCount > 0 && (
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
            style={{
              alignSelf: "flex-start",
              padding: "2px 6px",
              border: "none",
              borderRadius: 4,
              background: "transparent",
              color: "var(--text-muted)",
              font: "inherit",
              fontSize: 10,
              fontWeight: 600,
              lineHeight: 1.6,
              cursor: "pointer",
            }}
          >
            {t("History tasks · {count}", { count: historyCount })}
          </button>
        )}
        {historyOpen && group.historyTasks.map((task) => (
          <SubagentTaskRow key={task.taskId} task={task} />
        ))}
      </div>
    </div>
  );
}
