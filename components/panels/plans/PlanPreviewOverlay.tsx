"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { MarkdownContent } from "@/components/renderers/MarkdownContent";
import type { Plan } from "@/lib/shared/plans";
import { anchorDisplayText } from "./anchorText";

interface PlanPreviewOverlayProps {
  /** The plan being previewed — supplies the title, anchor and file path. */
  plan: Plan;
  /** The note to render: the saved note, or the live draft while the same row
   *  is open in the editor, so preview never shows stale text. */
  content: string;
  onClose: () => void;
}

/**
 * Read-only plan preview: a centered modal that renders the plan's note as
 * Markdown with the same custom blocks the notes/chat preview uses (code /
 * mermaid / svg / echarts). It is deliberately a *separate* surface from the
 * inline note editor — the expanded row stays the editing loop (ADR-0006),
 * and this is the "read the whole thing" view.
 *
 * Esc, a backdrop click and the ✕ all close it; body scroll is locked while
 * open. Portalled to `document.body` so it escapes the right panel's stacking
 * context.
 */
export function PlanPreviewOverlay({ plan, content, onClose }: PlanPreviewOverlayProps) {
  const { t, locale } = useI18n();
  // Mount the portal after the first client render to avoid an SSR mismatch.
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  useBodyScrollLock(true);
  useEscapeKey(true, (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  });

  if (!portalEl) return null;

  const anchorText = anchorDisplayText(plan.anchor, t, locale, "full");
  const hasNote = content.trim().length > 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Plan preview")}
      onMouseDown={(event) => {
        // Only a click on the backdrop itself closes — a click that started
        // inside the card must not, even if it ends on the backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "min(720px, 100%)",
          maxHeight: "min(82vh, 760px)",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.36)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 12px 10px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {plan.title}
            </div>
            <div
              style={{
                marginTop: 2,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 10.5,
                fontFamily: "var(--font-mono)",
                color: "var(--text-dim)",
                minWidth: 0,
              }}
            >
              {anchorText !== null && <span style={{ flexShrink: 0 }}>{anchorText}</span>}
              <span
                title={plan.absPath}
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {plan.path}
              </span>
            </div>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label={t("Close")}
            title={t("Close")}
            style={{
              flexShrink: 0,
              width: 26,
              height: 26,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 5,
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 18px 22px" }}>
          {hasNote ? (
            <MarkdownContent content={content} />
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("No note yet")}</div>
          )}
        </div>
      </div>
    </div>,
    portalEl,
  );
}
