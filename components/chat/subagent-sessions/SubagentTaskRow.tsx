"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { resolveSubagentTaskDuration } from "@/lib/shared/subagent-task-duration";
import { SUBAGENT_STATUS_COLORS, SUBAGENT_STATUS_LABEL_KEYS } from "@/lib/shared/subagent-status";
import type { SubagentTaskSummary } from "@/lib/shared/types";
import { formatDuration } from "@/components/scheduler/utils";

interface Props {
  task: SubagentTaskSummary;
}

export function SubagentTaskRow({ task }: Props) {
  const { t } = useI18n();
  const statusColor = SUBAGENT_STATUS_COLORS[task.status];
  const [now, setNow] = useState(() => Date.now());
  const duration = resolveSubagentTaskDuration(task, now);
  const ticking = duration.kind === "elapsed" && task.finishedAt === null;

  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticking]);

  const durationText = duration.kind === "queued"
    ? t("Queued")
    : formatDuration(duration.kind === "elapsed" ? duration.ms : null) ?? "—";

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
      <span
        style={{
          flexShrink: 0,
          minWidth: 38,
          textAlign: "right",
          whiteSpace: "nowrap",
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          lineHeight: 1.5,
        }}
      >
        {durationText}
      </span>
    </div>
  );
}
