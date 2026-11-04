import { Fragment, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ProviderGearIcon, ProviderIcon, resolveProviderIcon } from "@/components/ui/icons";
import { ThinkingBadge } from "@/components/scheduler/ThinkingBadge";
import { codePillStyle } from "@/components/scheduler/styles";
import {
  buildSchedulerConfigRows,
  type ChannelMeta,
  type SchedulerConfigValue,
  type SchedulerNotifyOutcome,
} from "@/lib/shared/scheduler-detail";
import type { ScheduledTask } from "@/lib/shared/scheduler";

interface Props {
  task: ScheduledTask;
  channelMeta: Record<string, ChannelMeta> | null;
  modelIcons?: Record<string, string>;
  modelIconPreferences?: Record<string, string>;
}

const OUTCOME_LABEL: Record<SchedulerNotifyOutcome, string> = {
  success: "On success",
  error: "On error",
  timeout: "On timeout",
};

export function SchedulerExecutionConfig({ task, channelMeta, modelIcons, modelIconPreferences }: Props) {
  const { t } = useI18n();
  const rows = buildSchedulerConfigRows(task, channelMeta);

  const renderValue = (value: SchedulerConfigValue, rowId: string): ReactNode => {
    if (value.kind === "missing") return <Missing>{t("Not set")}</Missing>;
    if (value.kind === "thinking") return <ThinkingBadge level={value.level} />;
    if (value.kind === "tools") {
      if (value.names === null) return t("All available tools");
      if (value.names.length === 0) return <span style={{ color: "var(--text-muted)" }}>{t("No tools, chat only")}</span>;
      return value.names.join(", ");
    }
    if (value.kind === "lifetime") {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <code style={codePillStyle}>{value.text}</code>
          {value.isDefault && <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("default")}</span>}
        </span>
      );
    }
    if (value.kind === "notifications") {
      if (value.channels.length === 0) return <Missing>{t("Not set")}</Missing>;
      return (
        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>{value.outcomes.map((outcome) => t(OUTCOME_LABEL[outcome])).join(" · ") || t("No outcome selected")}</span>
          {value.channels.map((channel, index) => (
            <span key={`${channel.type}:${channel.recipientId}:${index}`} style={{ color: "var(--text-muted)" }}>
              {channel.type}
              {channel.name ? `: ${channel.name}` : channel.unavailable ? ` ${t("channels.unavailable")}` : ""}
              <code style={{ ...codePillStyle, marginLeft: 6 }}>{channel.recipientId}</code>
            </span>
          ))}
        </span>
      );
    }
    const icon =
      rowId === "provider"
        ? resolveProviderIcon(task.provider, undefined, modelIcons, modelIconPreferences)
        : rowId === "model"
          ? resolveProviderIcon(task.provider, task.modelId, modelIcons, modelIconPreferences)
          : null;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {icon ? <ProviderIcon id={icon} size={14} fallback={<ProviderGearIcon size={14} />} /> : null}
        <code style={codePillStyle}>{value.text}</code>
      </span>
    );
  };

  return (
    <dl style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "10px 16px", margin: 0, fontSize: 13 }}>
      {rows.map((row) => (
        <Fragment key={row.id}>
          <dt style={{ color: "var(--text-muted)", minWidth: 0, fontSize: 12 }}>{t(row.labelKey)}</dt>
          <dd style={{ margin: 0, color: "var(--text)", minWidth: 0, wordBreak: "break-word" }}>
            {renderValue(row.value, row.id)}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Missing({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--error)", fontSize: 12 }}>{children}</span>;
}

