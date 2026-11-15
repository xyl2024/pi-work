"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { resolveMemoryConflict } from "@/lib/client/memory-panel";

const READONLY_STYLE = {
  flex: 1,
  minWidth: 0,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 12,
  lineHeight: 1.6,
  fontFamily: "var(--font-mono)",
  color: "var(--text)",
} as const;

export function MemoryConflictDialog({
  conflict,
  myContent,
}: {
  conflict: { diskContent: string; diskMtime: string };
  myContent: string;
}) {
  const { t } = useI18n();
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  if (!portalEl) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--bg-elevated)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--elevation-prominent)",
          padding: 20,
          width: "min(720px, 100%)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
          {t("File changed since it was opened")}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
              {t("My version")}
            </div>
            <div data-scroll-wide style={READONLY_STYLE}>{myContent}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
              {t("Current version on disk")}
            </div>
            <div data-scroll-wide style={READONLY_STYLE}>{conflict.diskContent}</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={() => resolveMemoryConflict("overwrite")}
            style={{
              padding: "7px 14px",
              background: "var(--accent)",
              border: "1px solid transparent",
              borderRadius: "var(--radius-sm)",
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {t("Overwrite")}
          </button>
          <button
            type="button"
            onClick={() => resolveMemoryConflict("discard")}
            style={{
              padding: "7px 14px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t("Discard my changes")}
          </button>
        </div>
      </div>
    </div>,
    portalEl,
  );
}
