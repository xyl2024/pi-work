"use client";

import { useI18n } from "@/hooks/useI18n";
import { GrokBot } from "@/components/grokbot/GrokBot";
import { SUBAGENT_STATUS_COLORS } from "@/lib/shared/subagent-status";
import type { SubagentBotAppearance } from "@/lib/shared/subagent";
import type { SubagentTaskStatus } from "@/lib/shared/types";

interface Props {
  childSessionId: string | null;
  profileName: string;
  bot: SubagentBotAppearance | null;
  title: string | null;
  status: SubagentTaskStatus;
  onOpenSession: (sessionId: string) => void;
}

export function SubagentSessionHeader({
  childSessionId,
  profileName,
  bot,
  title,
  status,
  onOpenSession,
}: Props) {
  const { t } = useI18n();
  const statusColor = SUBAGENT_STATUS_COLORS[status];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span aria-hidden="true" style={{ flexShrink: 0, width: 30, marginTop: -4 }}>
        {bot
          ? <GrokBot appearance={bot} size={30} interactive={false} />
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
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          {profileName || t("SubAgent")}
        </span>
        {title && (
          <span
            title={title}
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--text-muted)",
              fontSize: 10,
              lineHeight: 1.4,
            }}
          >
            {title}
          </span>
        )}
      </span>
      {childSessionId && (
        <button
          type="button"
          onClick={() => onOpenSession(childSessionId)}
          aria-label={t("Open subagent session")}
          title={t("Open subagent session")}
          style={{
            flexShrink: 0,
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
}
