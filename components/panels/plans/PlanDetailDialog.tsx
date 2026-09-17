"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { MarkdownContent } from "@/components/renderers/MarkdownContent";
import { MarkdownEditor } from "@/components/markdown-editor/MarkdownEditor";
import { planDialogLayout, type PlanConflictState } from "@/lib/client/plans";
import { countWords } from "@/lib/client/text";
import type { Plan } from "@/lib/shared/plans";
import { PlanConflictBanner } from "./PlanConflictBanner";
import { SaveStatusLabel, type PlanSaveStatus } from "./PlanRow";
import { anchorDisplayText } from "./anchorText";

export interface PlanDetailDialogProps {
  /** The plan as the list currently has it, so the header shows the latest
   *  title and anchor even if the file was re-scheduled outside the panel. */
  plan: Plan;
  /** The note as typed right now. The preview renders *this*, not the last
   *  saved line, so the two panes never disagree. */
  draft: string;
  saveStatus: PlanSaveStatus;
  /** A refused note save waiting for 「覆盖 / 重载」. Never a completion /
   *  re-schedule conflict — those answer on the row (`planConflictSurface`). */
  conflict: PlanConflictState | null;
  onChange: (value: string) => void;
  onSave: () => void;
  onResolveConflict: (choice: "overwrite" | "reload") => void;
  onDismissConflict: () => void;
  onClose: () => void;
}

/**
 * A plan's detail dialog: the note is written and read in the same place (#51).
 *
 * Wide enough → the Markdown editor and the rendered Markdown sit side by side,
 * and the preview follows every keystroke. Narrow → one pane plus an 编辑 / 预览
 * switch, the notes panel's answer to the same problem; it is held in component
 * state and never persisted.
 *
 * The editor is the notes panel's own (`MarkdownEditor`), so a plan note is
 * written with the same toolbar and shortcuts as a note — the dialog used to
 * pair this preview with a bare textarea.
 *
 * Closing is saving: Esc, the backdrop, the ✕ and switching to another plan all
 * flush the note first; there is no 「要保存吗」 question anywhere. A refused
 * save shows its 「覆盖 / 重载」 banner in the footer, next to the file it is
 * about.
 *
 * Portalled to `document.body` so it escapes the right panel's stacking
 * context and is not confined to the panel's width.
 */
export function PlanDetailDialog({
  plan,
  draft,
  saveStatus,
  conflict,
  onChange,
  onSave,
  onResolveConflict,
  onDismissConflict,
  onClose,
}: PlanDetailDialogProps) {
  const { t, locale } = useI18n();
  // Mount the portal after the first client render to avoid an SSR mismatch.
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  // Narrow mode: which pane is shown. Opening on the preview is the same habit
  // the notes panel has — a document is shown before its editor — and the
  // dialog is only reached by clicking a plan, so reading it is what that click
  // asked for. The editor is one click away.
  const [pane, setPane] = useState<"edit" | "preview">("preview");
  // The card's measured width, which is what decides the layout. 0 until the
  // observer has run (a pane switch is the harmless wrong guess for one frame,
  // and it is corrected before paint).
  const [availableWidth, setAvailableWidth] = useState(0);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  useBodyScrollLock(true);
  useEscapeKey(true, (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  });

  // The card is sized by CSS (`min(900px, 92vw)`), so the width it actually got
  // is the only honest answer to "is there room for two columns?".
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    const measure = () => setAvailableWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [portalEl]);

  if (!portalEl) return null;

  const layout = planDialogLayout(availableWidth);
  const anchorText = anchorDisplayText(plan.anchor, t, locale, "full");
  const editor = (
    <MarkdownEditor
      value={draft}
      onChange={onChange}
      placeholder={t("Add a note…")}
      ariaLabel={t("Add a note…")}
      fontSize={12.5}
      padding="12px 14px"
    />
  );
  const preview = <NotePreview content={draft} />;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Plan details")}
      onMouseDown={(event) => {
        // Only a click on the backdrop itself closes — a click that started
        // inside the card must not, even if it ends on the backdrop.
        // `detail > 1` is the second half of a double-click: the row that was
        // double-clicked has already opened this dialog, and swallowing that
        // second press keeps a habitual double-click from closing it again.
        if (event.detail > 1) return;
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
        ref={cardRef}
        onKeyDown={(event) => {
          // Ctrl/Cmd+S saves now instead of waiting out the debounce. Handled on
          // the card (not on the window) so a hidden panel behind this one
          // cannot answer the same keystroke.
          if ((event.metaKey || event.ctrlKey) && event.code === "KeyS") {
            event.preventDefault();
            onSave();
          }
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          width: "min(900px, 92vw)",
          height: "min(82vh, 760px)",
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
            {/* The title is the file name — read-only here. Renaming a plan is
                moving it, which the row's re-schedule chips still own. */}
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
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {plan.path}
              </span>
            </div>
          </div>
          {layout === "tabs" && <PaneToggle pane={pane} onChange={setPane} />}
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

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {layout === "split" ? (
            <>
              <div
                style={{
                  flex: "1 1 50%",
                  minWidth: 0,
                  display: "flex",
                  borderRight: "1px solid var(--border)",
                }}
              >
                {editor}
              </div>
              <div style={{ flex: "1 1 50%", minWidth: 0, overflowY: "auto" }}>{preview}</div>
            </>
          ) : pane === "edit" ? (
            <div style={{ flex: 1, minWidth: 0, display: "flex" }}>{editor}</div>
          ) : (
            <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>{preview}</div>
          )}
        </div>

        {/* The refused note save is answered here, where it was asked for. */}
        {conflict !== null && (
          <PlanConflictBanner
            conflict={conflict}
            onResolve={onResolveConflict}
            onDismiss={onDismissConflict}
            style={{ flexShrink: 0, margin: "0 12px 8px" }}
          />
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            height: 26,
            padding: "0 12px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
            fontSize: 11,
            color: "var(--text-dim)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span>
              {countWords(draft)} {t("Words")}
            </span>
            <span style={{ color: "var(--border)" }}>·</span>
            <span>
              {draft.length} {t("Characters")}
            </span>
          </span>
          <span style={{ flex: 1 }} />
          <SaveStatusLabel status={saveStatus} />
        </div>
      </div>
    </div>,
    portalEl,
  );
}

/** The live Markdown rendering of the note, with the same custom blocks
 *  (code / mermaid / svg / echarts) as the chat and notes previews. */
function NotePreview({ content }: { content: string }) {
  const { t } = useI18n();
  return (
    <div style={{ padding: "12px 18px 24px", minHeight: "100%" }}>
      {content.trim().length > 0 ? (
        <MarkdownContent content={content} />
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("No note yet")}</div>
      )}
    </div>
  );
}

/** Narrow mode only: which of the two panes is on screen. */
function PaneToggle({
  pane,
  onChange,
}: {
  pane: "edit" | "preview";
  onChange: (pane: "edit" | "preview") => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        flexShrink: 0,
        marginTop: 2,
        height: 24,
        padding: 2,
        gap: 2,
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
        borderRadius: 7,
      }}
    >
      <PaneTab active={pane === "edit"} label={t("Edit")} onClick={() => onChange("edit")} />
      <PaneTab active={pane === "preview"} label={t("Preview")} onClick={() => onChange("preview")} />
    </div>
  );
}

function PaneTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "0 10px",
        fontSize: 11,
        height: 18,
        lineHeight: "18px",
        color: active ? "var(--accent)" : "var(--text-muted)",
        background: active ? "var(--bg-selected)" : "transparent",
        border: "none",
        borderRadius: 5,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {label}
    </button>
  );
}
