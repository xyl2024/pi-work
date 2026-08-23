"use client";

import { type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useEscapeKey } from "@/hooks/useEscapeKey";

/**
 * Viewport-sized overlay used by SvgBlock / MermaidBlock / EchartsBlock to
 * inspect a rendered diagram full-screen. Shared so each renderer doesn't
 * re-implement the same body-scroll-lock + Escape + backdrop-click-to-close
 * boilerplate.
 *
 * Two visual layouts via the optional `header` prop:
 *
 *  - **With header** (`header` provided): a strip renders at the top with
 *    `header` content on the left and a plain close button on the right.
 *    Used by SvgBlock which shows a `svg` label.
 *
 *  - **Without header**: a floating close button sits in the top-right
 *    corner with a hover highlight. Used by MermaidBlock / EchartsBlock.
 *
 * In both modes the overlay locks `document.body.style.overflow`, listens
 * for `Escape` (preventDefault + stopPropagation so it doesn't bubble to
 * other handlers like the chat input's Escape-to-close-slash-menu), and
 * closes on click outside the inner content (the `e.target ===
 * e.currentTarget` check is what wires that).
 */
export interface FullscreenOverlayProps {
  onClose: () => void;
  /** Optional header strip content. When present, renders a top strip with
   *  this content on the left and a close button on the right; otherwise
   *  renders a floating close button in the top-right corner. */
  header?: ReactNode;
  /** Custom z-index. Default 9999 to sit above normal content but below the
   *  modal-animation stack (which uses 10000). */
  zIndex?: number;
  /** Backdrop color. Default near-opaque black. */
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

  // Always active while this overlay is mounted. The body-scroll-lock
  // hook keeps overflow hidden, and the Escape handler fires `onClose`
  // (with the same preventDefault/stopPropagation we previously did by
  // hand, so the chat input's Escape-to-close-slash-menu doesn't leak
  // through the capture-phase listener).
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
