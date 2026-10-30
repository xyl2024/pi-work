"use client";

import { type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useEscapeKey } from "@/hooks/useEscapeKey";

export interface FullscreenOverlayProps {
  onClose: () => void;
  header?: ReactNode;
  zIndex?: number;
  background?: string;
  children: ReactNode;
}

const FLOATING_CLOSE_STYLE_BASE = {
  background: "rgba(255,255,255,0.18)",
  color: "rgba(255,255,255,0.95)",
  border: "1px solid rgba(255,255,255,0.35)",
};

export function FullscreenOverlay({
  onClose,
  header,
  zIndex = 9999,
  background = "rgba(0, 0, 0, 0.92)",
  children,
}: FullscreenOverlayProps) {
  const { t } = useI18n();

  useBodyScrollLock(true);
  useEscapeKey(true, (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background,
        zIndex,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {header ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 16px",
            background: "rgba(0, 0, 0, 0.5)",
            color: "rgba(255,255,255,0.9)",
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {header}
          <button
            onClick={onClose}
            title={t("Close")}
            style={{
              marginLeft: "auto",
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 5,
              fontFamily: "var(--font-mono)",
              lineHeight: 1.2,
            }}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={onClose}
          title={t("Close")}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.28)";
          }}
          onMouseLeave={(e) => {
            Object.assign(e.currentTarget.style, FLOATING_CLOSE_STYLE_BASE);
          }}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 1,
            width: 36,
            height: 36,
            padding: 0,
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...FLOATING_CLOSE_STYLE_BASE,
            borderRadius: 8,
            fontFamily: "var(--font-mono)",
          }}
        >
          ✕
        </button>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</div>
    </div>
  );
}
