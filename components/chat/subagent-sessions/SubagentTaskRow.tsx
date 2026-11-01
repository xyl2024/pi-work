"use client";

import { useI18n } from "@/hooks/useI18n";
import { SUBAGENT_STATUS_COLORS, SUBAGENT_STATUS_LABEL_KEYS } from "@/lib/shared/subagent-status";
import type { SubagentTaskSummary } from "@/lib/shared/types";

interface Props {
  task: SubagentTaskSummary;
}

export function SubagentTaskRow({ task }: Props) {
  const { t } = useI18n();
  const statusColor = SUBAGENT_STATUS_COLORS[task.status];

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", padding: "2px 0" }}>
      <span
        style={{
          flexShrink: 0,
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          lineHeight: 1.5,
        }}
      >
        #{task.taskId}
      </span>
      <span
        title={task.description}
        style={{
          minWidth: 0,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        {task.description}
      </span>
      <span style={{ flexShrink: 0, color: statusColor, fontSize: 10, lineHeight: 1.5 }}>
        {t(SUBAGENT_STATUS_LABEL_KEYS[task.status])}
      </span>
    </div>
  );
}
