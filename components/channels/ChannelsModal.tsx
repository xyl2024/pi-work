/**
 * ChannelsModal — top-level entry for managing messaging channels, on par
 * with Models / Prompts / Skills / Scheduled tasks.
 *
 * Holds the platform list (WeChat first, dingtalk/feishu/discord later)
 * and the per-channel detail (QR login, pairing code, workspace, enable /
 * disable, delete).
 */
"use client";

import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { CloseIcon } from "@/components/ui/icons";
import { ChannelsSection } from "./ChannelsSection";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ChannelsModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const { requestClose, backdropStyle, panelStyle, isVisible } = useModalAnimation({ isOpen: open, onClose });

  if (!isVisible) return null;

  return (
    <div
      style={backdropStyle}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        style={{
          ...panelStyle,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: 720,
          maxWidth: "94vw",
          height: "82vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
          overflow: "hidden",
        }}
      >
        {/* Header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            background: "var(--bg)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {t("Channels")}
          </span>
          <button
            onClick={requestClose}
            aria-label={t("Close")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              padding: 0,
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <CloseIcon width={14} height={14} />
          </button>
        </div>

        {/* Body */}
        <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          <ChannelsSection />
        </div>
      </div>
    </div>
  );
}