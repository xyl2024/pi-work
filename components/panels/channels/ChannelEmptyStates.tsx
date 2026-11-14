"use client";

import { useI18n } from "@/hooks/useI18n";
import { openChannelForm } from "@/lib/client/channels-panel";
import { GlobeIcon, PlusIcon } from "@/components/ui/icons";

export function ChannelSelectHint() {
  const { t } = useI18n();
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        fontSize: 13,
        color: "var(--text-muted)",
      }}
    >
      {t("Select a channel to see its details")}
    </div>
  );
}

export function ChannelCreateGuide() {
  const { t } = useI18n();
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        textAlign: "center",
        color: "var(--text-muted)",
      }}
    >
      <GlobeIcon size={56} strokeWidth={1.2} style={{ color: "var(--text-muted)", margin: "0 auto 12px", display: "block" }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
        {t("channels.noChannels")}
      </div>
      <button
        type="button"
        onClick={openChannelForm}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          borderRadius: "var(--radius-sm)",
          padding: "7px 14px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <PlusIcon width={11} height={11} />
        {t("New channel")}
      </button>
    </div>
  );
}
