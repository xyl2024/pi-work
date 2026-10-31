"use client";

import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../ui/Tooltip";
import { formatTime } from "./message-view/utils";
import type { ModelChangeMarker, ThinkingLevelChangeMarker } from "@/lib/shared/types";

type Props =
  | (ModelChangeMarker & { modelName: string })
  | ThinkingLevelChangeMarker;

export function ChangeDivider(props: Props) {
  const { t } = useI18n();
  const marker = props;
  const label = marker.kind === "model"
    ? t("Model changed to {model}", { model: marker.modelName })
    : t("Thinking level changed to {level}", { level: marker.thinkingLevel });
  const timestamp = marker.timestamp ? formatTime(new Date(marker.timestamp).getTime()) : null;
  const line = (
    <div
      role="note"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "14px 0",
        color: "var(--text-muted)",
        fontSize: 11,
        userSelect: "none",
      }}
    >
      <span style={{ flex: 1, borderTop: "1px dashed color-mix(in srgb, var(--accent) 45%, transparent)" }} />
      <span>{label}</span>
      <span style={{ flex: 1, borderTop: "1px dashed color-mix(in srgb, var(--accent) 45%, transparent)" }} />
    </div>
  );
  if (!timestamp) return line;
  return (
    <Tooltip content={timestamp}>
      <div tabIndex={0} style={{ outline: "none" }}>{line}</div>
    </Tooltip>
  );
}
