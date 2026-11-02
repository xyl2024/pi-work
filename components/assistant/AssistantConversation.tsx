"use client";

import { useI18n } from "@/hooks/useI18n";

export function AssistantConversation({ isActive }: { isActive: boolean }) {
  const { t } = useI18n();

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: isActive ? "flex" : "none",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} />
      <div style={{ flexShrink: 0, padding: "0 16px 16px" }}>
        <div
          aria-disabled
          style={{
            display: "flex",
            alignItems: "center",
            minHeight: 44,
            padding: "0 14px",
            borderRadius: 14,
            border: "1px solid var(--border)",
            background: "var(--bg-hover)",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          {t("Message the assistant")}
        </div>
      </div>
    </div>
  );
}
