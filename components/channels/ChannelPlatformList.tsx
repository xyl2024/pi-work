"use client";

import { useI18n } from "@/hooks/useI18n";

export interface PlatformDef {
  id: string;
  labelKey: string;
}

/** Platform list shown on the left of the Channels panel. */
export const PLATFORMS: PlatformDef[] = [
  { id: "wechat", labelKey: "platform.wechat" },
  { id: "dingtalk", labelKey: "platform.dingtalk" },
  { id: "feishu", labelKey: "platform.feishu" },
  { id: "discord", labelKey: "platform.discord" },
];

export function ChannelPlatformList({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (platformId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {PLATFORMS.map((platform) => {
        const isActive = active === platform.id;
        return (
          <button
            key={platform.id}
            onClick={() => onSelect(platform.id)}
            style={{
              display: "block",
              width: "100%",
              padding: "9px 10px",
              textAlign: "left",
              border: 0,
              borderRadius: 6,
              background: isActive ? "var(--bg-selected)" : "transparent",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t(platform.labelKey)}
          </button>
        );
      })}
    </div>
  );
}