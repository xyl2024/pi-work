"use client";

import { useI18n } from "@/hooks/useI18n";
import { channelsBack } from "@/lib/client/channels-store";

/**
 * The channels panel's "up one level" control. The detail page draws one so
 * the page stack is navigable with the mouse, matching what Escape does with
 * the keyboard (see `escapeChannels`).
 */
export function ChannelsBackButton() {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={channelsBack}
      aria-label={t("Back to channels")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 9px",
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: 5,
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: 12,
        flexShrink: 0,
        fontFamily: "inherit",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="15 6 9 12 15 18" />
      </svg>
      {t("Back")}
    </button>
  );
}
