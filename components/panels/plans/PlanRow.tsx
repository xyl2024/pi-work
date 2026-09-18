"use client";

import { useCallback, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { IconButton } from "@/components/ui/IconButton";
import {
  noteSummary,
  weekEndOf,
  type Plan,
  type PlanAnchorChoice,
} from "@/lib/shared/plans";
import type { PlanConflictState } from "@/lib/client/plans";
import { AnchorChips } from "./AnchorChips";
import { PlanConflictBanner } from "./PlanConflictBanner";
import { anchorDisplayText } from "./anchorText";

/** Save state of the open note, mirroring the notes editor's indicator. */
export type PlanSaveStatus = "saved" | "unsaved" | "saving" | "error";

export interface PlanRowProps {
  plan: Plan;
  /** Show a day anchor's date on the row (overdue / upcoming sections). Week
   *  and month anchors always show their own label regardless. */
  showDate: boolean;
  /** True when this row's re-schedule chip menu is open. */
  rescheduleOpen: boolean;
  /** The one-tap choice this plan's anchor currently maps to, if any. */
  activeChoice: PlanAnchorChoice | null;
  /** True when this plan sits on the anchor the mini calendar navigated to.
   *  The panel uses it to scroll that row into view; it is deliberately *not* a
   *  visual state — a calendar pick chooses the next plan's anchor, it does not
   *  select a row. */
  anchorMatch: boolean;
  /** A refused completion / re-schedule waiting for 「覆盖 / 重载」. A refused
   *  *note* save never reaches the row: the detail dialog hosts that banner
   *  (`planConflictSurface`). */
  conflict: PlanConflictState | null;
  /** Open this plan's detail dialog. The whole row except its controls is a
   *  hit target for it. */
  onOpen: () => void;
  onToggleDone: () => void;
  onToggleReschedule: () => void;
  onReschedule: (choice: PlanAnchorChoice) => void;
  /** Rename this plan. The title is the second half of the file name, so the
   *  panel renames the file in place: the request is resolved against the
   *  plan's own anchor, never against the create input's. */
  onRename: (title: string) => void;
  onResolveConflict: (choice: "overwrite" | "reload") => void;
  onDismissConflict: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
}

/**
 * One plan line: round completion checkbox, title, a grey one-line note
 * summary, and — at the right edge — the anchor's date, which the hover actions
 * (rename / reschedule / copy path / delete) swap in for as long as the pointer
 * is on the row.
 *
 * Clicking the line — title, summary or the empty space around them — opens the
 * plan's detail dialog, where the note is written and read (#51). The note
 * itself is not edited here any more: the row is presentation plus the click
 * target, and every decision (debounce, conflict resolution, what gets written)
 * stays in the panel above it. The controls (checkbox, hover actions, the
 * re-schedule chips, the rename input) are the exceptions and keep their own
 * click.
 */
export function PlanRow({
  plan,
  showDate,
  rescheduleOpen,
  activeChoice,
  anchorMatch,
  conflict,
  onOpen,
  onToggleDone,
  onToggleReschedule,
  onReschedule,
  onRename,
  onResolveConflict,
  onDismissConflict,
  onCopyPath,
  onDelete,
}: PlanRowProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  // Renaming turns the title into an input *in the row*, so the new name is
  // typed where the old one is shown — the same rename the session list offers.
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(plan.title);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const summary = noteSummary(plan.note);
  const actionsVisible = hovered || rescheduleOpen;

  /** Start a rename with the current name selected, so typing replaces it. */
  const beginRename = useCallback(() => {
    setRenameValue(plan.title);
    setRenaming(true);
    // The input is rendered by the state update above; select it once mounted.
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [plan.title]);

  /**
   * Enter / losing focus commits, Escape cancels. An empty or unchanged name is
   * not a write: the file name *is* the title, so "no change" means no rename
   * at all (and the server would refuse an empty one anyway).
   */
  const commitRename = useCallback(() => {
    if (!renaming) return;
    setRenaming(false);
    const next = renameValue.trim();
    if (!next || next === plan.title) return;
    onRename(next);
  }, [onRename, plan.title, renameValue, renaming]);

  return (
    <div
      data-plan-anchor-match={anchorMatch ? "true" : undefined}
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        borderRadius: 5,
        // Rows sit directly on the panel background; only hover puts a surface
        // under them.
        background: hovered ? "var(--bg-hover)" : "transparent",
        // Completed plans stay exactly where they were — this is a record, not
        // a cleanup — so they only fade.
        opacity: plan.done ? 0.55 : 1,
        cursor: "pointer",
        transition: "opacity 0.15s, background 0.1s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 6px",
        }}
      >
        <DoneCheckbox done={plan.done} label={t("Toggle done")} onToggle={onToggleDone} />

        {/* The title is the row's keyboard entry point — Tab to it and Enter /
            Space open the dialog, exactly like clicking the line does. Clicks
            are handled here so the title never opens the dialog twice. While
            renaming it is replaced by an input, which is not a button and does
            not open anything. */}
        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            aria-label={t("Rename plan")}
            autoFocus
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={commitRename}
            // The input sits inside the row's click target: its own clicks must
            // not reach it, or renaming would open the dialog on every keystroke.
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              // `isComposing` lets Enter that commits an IME candidate (Chinese
              // input) through untouched — the same guard the create box uses.
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRenaming(false);
              }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              height: 20,
              padding: "0 6px",
              fontSize: 12.5,
              color: "var(--text)",
              background: "var(--bg)",
              border: "1px solid var(--accent)",
              borderRadius: 5,
              outline: "none",
            }}
          />
        ) : (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
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
            {summary && (
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
        )}

        {/* The row's right edge is one box holding two things in the same
            grid cell: the anchor's date, which is what the row normally ends
            with, and the hover actions, which take its place under the
            pointer. Stacking them in one cell means the box is as wide as the
            wider of the two and never resizes — the title keeps its width
            whether the pointer is on the row or not. */}
        <span style={{ flexShrink: 0, display: "grid", alignItems: "center", justifyItems: "end" }}>
          <span
            style={{
              gridArea: "1 / 1",
              display: "flex",
              alignItems: "center",
              // Decoration, not a control: a click on the date belongs to the
              // row (and opening the dialog is what the row does).
              pointerEvents: "none",
              opacity: actionsVisible ? 0 : 1,
              transition: "opacity 0.1s",
            }}
          >
            <AnchorLabel anchor={plan.anchor} showDate={showDate} />
          </span>

          <span
            onClick={(event) => event.stopPropagation()}
            style={{
              gridArea: "1 / 1",
              display: "flex",
              alignItems: "center",
              gap: 0,
              // Kept in the layout and focusable so the actions stay reachable by
              // keyboard; only their visibility follows hover / opening the
              // re-schedule chips. `pointer-events: none` while hidden is what
              // lets a click there fall through and open the dialog.
              opacity: actionsVisible ? 1 : 0,
              pointerEvents: actionsVisible ? "auto" : "none",
              transition: "opacity 0.1s",
            }}
          >
            <IconButton
              label={t("Rename plan")}
              size="xs"
              active={renaming}
              onClick={beginRename}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
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
        </span>
      </div>

      {rescheduleOpen && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{ padding: "0 6px 6px" }}
        >
          <AnchorChips activeChoice={activeChoice} label={t("Move plan to")} onSelect={onReschedule} />
        </div>
      )}

      {/* Only a refused completion / re-schedule / rename lands here; a refused
          note save is answered inside the detail dialog (#51). */}
      {conflict !== null && (
        <PlanConflictBanner
          conflict={conflict}
          onResolve={onResolveConflict}
          onDismiss={onDismissConflict}
          style={{ margin: "0 6px 6px" }}
        />
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
      onClick={(event) => {
        // The checkbox is a control, not a hit target for the dialog.
        event.stopPropagation();
        onToggle();
      }}
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

/** The note's save state as a dot + label. Shared by the row and the detail
 *  dialog's footer, so 「已保存 / 未保存 / 保存中 / 保存失败」 reads the same in
 *  both, screen readers included. */
export function SaveStatusLabel({ status }: { status: PlanSaveStatus }) {
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
