"use client";

/**
 * SidebarBackPanel — the back face of the sidebar flip card.
 *
 * Reserved area for sidebar content that would otherwise pile up in the
 * Pi Bot / Sessions / Explorer column. Body is a placeholder until the real
 * content is decided; the header carries the flip-back button.
 */

import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "../ui/Tooltip";

interface Props {
  /** Flip back to the front face. */
  onFlip: () => void;
}

export function SidebarBackPanel({ onFlip }: Props) {
  const { t } = useI18n();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "12px 10px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {t("More")}
          </span>
          <Tooltip content={t("Show front")}>
            <button
              type="button"
              onClick={onFlip}
              aria-label={t("Show front")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(37,99,235,0.08)",
                border: "1px solid rgba(37,99,235,0.35)",
                color: "var(--accent)",
                cursor: "pointer",
                width: 32, height: 32,
                borderRadius: 7,
                padding: 0,
                flexShrink: 0,
                transition: "background 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(37,99,235,0.18)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.55)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(37,99,235,0.08)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 2l4 4-4 4" />
                <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                <path d="M7 22l-4-4 4-4" />
                <path d="M21 13v1a4 4 0 0 1-4 4H3" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>

      <div data-scroll-side style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "0 10px 10px" }}>
        <div
          style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 12px",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            color: "var(--text-dim)",
            fontSize: 12,
            lineHeight: 1.5,
            textAlign: "center",
          }}
        >
          {t("Additional sidebar content will live here")}
        </div>
      </div>
    </div>
  );
}
