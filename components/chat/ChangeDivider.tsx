"use client";

import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../ui/Tooltip";
import { formatTime } from "./message-view/utils";
import type { ModelChangeMarker } from "@/lib/shared/types";

interface Props {
  marker: ModelChangeMarker;
  modelName: string;
}

export function ChangeDivider({ marker, modelName }: Props) {
  const { t } = useI18n();
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
      <span>{t("Model changed to {model}", { model: modelName })}</span>
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
