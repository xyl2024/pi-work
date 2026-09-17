"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { IconButton } from "@/components/ui/IconButton";
import {
  noteSummary,
  weekEndOf,
  type Plan,
  type PlanAnchor,
  type PlanAnchorChoice,
  type PlanViewMode,
} from "@/lib/shared/plans";
import { AnchorChips } from "./AnchorChips";
import { anchorDisplayText } from "./anchorText";

/** Save state of the row's note, mirroring the notes editor's indicator. */
export type PlanSaveStatus = "saved" | "unsaved" | "saving" | "error";

/**
 * What 「覆盖」 must redo after the user answers a conflict: the note save, the
 * completion state the checkbox was aiming for, or the re-schedule the chip
 * asked for. Carried as data instead of re-derived from the list, which is
 * stale exactly when a conflict happens.
 */
export type PlanConflictRetry =
  | { kind: "note" }
  | { kind: "done"; done: boolean }
  | { kind: "anchor"; anchor: PlanAnchor };

/** A write the server refused with 409 because the panel's view was stale. */
export interface PlanConflictState {
  /** `modified` = content changed under us, `missing` = moved / renamed / gone. */
  code: "modified" | "missing";
  /** Where the same-titled plan lives now, when the server could tell. */
  movedTo: string | null;
  /** The action that was refused. */
  retry: PlanConflictRetry;
}

export interface PlanRowProps {
  plan: Plan;
  /** Row shape: `compact` is the dense line (also used by 时间轴), `cards` the
   *  lighter card of the 卡片 appearance mode (#48). Grouping is the panel's
   *  job — this only changes the container. */
  variant?: Extract<PlanViewMode, "compact" | "cards">;
  /** Show a day anchor's date on the row (overdue / upcoming sections). Week
   *  and month anchors always show their own label regardless. */
  showDate: boolean;
  /** True when this row's note editor is the open one. */
  expanded: boolean;
  /** True when this row's re-schedule chip menu is open. */
  rescheduleOpen: boolean;
  /** The one-tap choice this plan's anchor currently maps to, if any. */
  activeChoice: PlanAnchorChoice | null;
  /** True when this plan sits on the anchor the mini calendar navigated to
   *  — the row a calendar pick marked. */
  selected: boolean;
  /** The note being edited (only meaningful while expanded). */
  draft: string;
  saveStatus: PlanSaveStatus;
  conflict: PlanConflictState | null;
  onToggleExpand: () => void;
  onToggleDone: () => void;
  onToggleReschedule: () => void;
  onReschedule: (choice: PlanAnchorChoice) => void;
  /** Open the read-only Markdown preview of this plan's note. */
  onPreview: () => void;
  onNoteChange: (value: string) => void;
  onSaveNote: () => void;
  onResolveConflict: (choice: "overwrite" | "reload") => void;
  onDismissConflict: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
}

/**
 * One plan line: round completion checkbox, title, a grey one-line note
 * summary, and the hover actions (preview / reschedule / copy path / delete).
 * Expanding the row swaps the summary for the multi-line note editor, where
 * Ctrl/Cmd+S saves at once; the preview action opens the note as rendered
 * Markdown in the panel's overlay instead.
 *
 * The row is presentation plus a textarea — every decision (debounce, conflict
 * resolution, what gets written) stays in the panel above it.
 */
export function PlanRow({
  plan,
  variant = "compact",
  showDate,
  expanded,
  rescheduleOpen,
  activeChoice,
  selected,
  draft,
  saveStatus,
  conflict,
  onToggleExpand,
  onToggleDone,
  onToggleReschedule,
  onReschedule,
  onPreview,
  onNoteChange,
  onSaveNote,
  onResolveConflict,
  onDismissConflict,
  onCopyPath,
  onDelete,
}: PlanRowProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const summary = noteSummary(plan.note);
  const actionsVisible = hovered || expanded || rescheduleOpen;
  const card = variant === "cards";

  return (
    <div
      data-plan-selected={selected ? "true" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        borderRadius: card ? 7 : 5,
        // Cards keep a resting surface so the list reads as separate objects;
        // compact rows sit directly on the panel background.
        background: selected
          ? "var(--bg-selected)"
          : hovered && !expanded
            ? "var(--bg-hover)"
            : card
              ? "var(--bg-subtle)"
              : "transparent",
        border: card ? "1px solid var(--border)" : undefined,
        marginBottom: card ? 6 : undefined,
        // A left accent bar marks the row the mini calendar navigated to,
        // without moving or recolouring the list.
        boxShadow: selected ? "inset 2px 0 0 var(--accent)" : undefined,
        // Completed plans stay exactly where they were — this is a record, not
        // a cleanup — so they only fade.
        opacity: plan.done ? 0.55 : 1,
        transition: "opacity 0.15s, background 0.1s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: card ? "7px 8px" : "5px 6px",
        }}
      >
        <DoneCheckbox done={plan.done} label={t("Toggle done")} onToggle={onToggleDone} />

        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: 1,
            padding: 0,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 12.5,
              color: "var(--text)",
              textDecoration: plan.done ? "line-through" : "none",
              textDecorationColor: "var(--text-dim)",
            }}
          >
            {plan.title}
          </span>
          {!expanded && summary && (
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              {summary}
            </span>
          )}
        </button>

        <AnchorLabel anchor={plan.anchor} showDate={showDate} />

        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
            flexShrink: 0,
            // Kept in the layout and focusable so the actions stay reachable by
            // keyboard; only their visibility follows hover / expansion.
            opacity: actionsVisible ? 1 : 0,
            pointerEvents: actionsVisible ? "auto" : "none",
            transition: "opacity 0.1s",
          }}
        >
          <IconButton label={t("Preview")} size="xs" onClick={onPreview}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </IconButton>
          <IconButton
            label={t("Reschedule")}
            size="xs"
            active={rescheduleOpen}
            onClick={onToggleReschedule}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M8 3v4M16 3v4M3 10h18" />
            </svg>
          </IconButton>
          <IconButton label={t("Copy path")} size="xs" onClick={onCopyPath}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="12" height="12" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </IconButton>
          <IconButton label={t("Delete")} size="xs" onClick={onDelete}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </IconButton>
        </span>
      </div>

      {rescheduleOpen && (
        <div style={{ padding: card ? "0 8px 8px" : "0 6px 6px" }}>
          <AnchorChips activeChoice={activeChoice} label={t("Move plan to")} onSelect={onReschedule} />
        </div>
      )}

      {expanded && (
        <div style={{ padding: card ? "0 8px 8px" : "0 6px 6px" }}>
          <textarea
            autoFocus
            value={draft}
            onChange={(event) => onNoteChange(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl/Cmd+S saves now instead of waiting out the debounce.
              if ((event.metaKey || event.ctrlKey) && event.code === "KeyS") {
                event.preventDefault();
                onSaveNote();
              }
            }}
            placeholder={t("Add a note…")}
            aria-label={t("Add a note…")}
            rows={3}
            style={{
              display: "block",
              width: "100%",
              minHeight: 54,
              resize: "vertical",
              padding: "5px 7px",
              fontSize: 12,
              fontFamily: "inherit",
              lineHeight: 1.5,
              color: "var(--text)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 2px 0",
              fontSize: 10.5,
              color: "var(--text-dim)",
            }}
          >
            <span style={{ flex: 1 }} />
            <SaveStatusLabel status={saveStatus} />
          </div>
        </div>
      )}

      {conflict !== null && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            margin: card ? "0 8px 8px" : "0 6px 6px",
            padding: "6px 8px",
            fontSize: 11,
            color: "var(--text)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--warning)",
            borderRadius: 5,
          }}
        >
          <span style={{ flex: 1, minWidth: 120 }}>
            {conflict.code === "missing"
              ? t("This plan was moved or renamed outside the panel")
              : t("This plan changed outside the panel")}
          </span>
          <ConflictButton onClick={() => onResolveConflict("overwrite")}>
            {t("Overwrite")}
          </ConflictButton>
          {/* A moved file has somewhere to reload *to*; a content change only has
              the disk version, so the label says what the second choice does. */}
          {conflict.code === "missing" && conflict.movedTo === null ? null : (
            <ConflictButton onClick={() => onResolveConflict("reload")}>
              {conflict.code === "missing"
                ? t("Reload to the new location")
                : t("Reload")}
            </ConflictButton>
          )}
          <button
            type="button"
            onClick={onDismissConflict}
            aria-label={t("Dismiss")}
            style={{
              display: "inline-flex",
              padding: 2,
              background: "transparent",
              border: "none",
              color: "var(--text-dim)",
              cursor: "pointer",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The anchor as a compact label: `09-15` for a day, `9/28–10/4` for a week
 * (plus which month owns it when the week straddles a month), `2026年9月` for
 * a month.
 *
 * A week or month anchor always shows its label — the section header says
 * "this week" / "this month", not *which* week or month — while a day anchor
 * only shows it where the section does not already (`showDate`). The inbox has
 * no time to show.
 */
function AnchorLabel({ anchor, showDate }: { anchor: Plan["anchor"]; showDate: boolean }) {
  const { t, locale } = useI18n();
  if (anchor.kind === "inbox") return null;
  if (anchor.kind === "day" && !showDate) return null;
  const text = anchorDisplayText(anchor, t, locale, "short");
  if (text === null) return null;
  const title =
    anchor.kind === "week" ? `${anchor.date} – ${weekEndOf(anchor.date)}` : undefined;

  return (
    <span
      title={title}
      style={{
        flexShrink: 0,
        fontSize: 10.5,
        fontFamily: "var(--font-mono)",
        color: "var(--text-dim)",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

/** Round checkbox: filled + check when done, hollow when not. */
function DoneCheckbox({
  done,
  label,
  onToggle,
}: {
  done: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={onToggle}
      style={{
        flexShrink: 0,
        width: 14,
        height: 14,
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        background: done ? "var(--success)" : "transparent",
        border: done ? "1.5px solid var(--success)" : "1.5px solid var(--text-dim)",
        color: "var(--bg)",
        cursor: "pointer",
        transition: "background 0.15s, border-color 0.15s, transform 0.1s",
      }}
    >
      {done && (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 13 9 18 20 6" />
        </svg>
      )}
    </button>
  );
}

const STATUS_COLOR: Record<PlanSaveStatus, string> = {
  saved: "var(--success)",
  saving: "var(--text-dim)",
  unsaved: "var(--warning)",
  error: "var(--error)",
};

const STATUS_KEY: Record<PlanSaveStatus, string> = {
  saved: "Saved",
  saving: "Saving",
  unsaved: "Unsaved changes",
  error: "Save failed",
};

function SaveStatusLabel({ status }: { status: PlanSaveStatus }) {
  const { t } = useI18n();
  return (
    <span
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color: status === "error" ? "var(--error)" : "var(--text-dim)",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: STATUS_COLOR[status],
          flexShrink: 0,
        }}
      />
      {t(STATUS_KEY[status])}
    </span>
  );
}

function ConflictButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        padding: "2px 8px",
        fontSize: 11,
        color: "var(--text)",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 5,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
