"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { RefreshIconButton } from "@/components/ui/RefreshIconButton";
import { useCopyPath } from "./useCopyPath";
import {
  deletePlan,
  fetchPlans,
  planConflictSurface,
  type PlanConflictState,
  type PlanConflictSurface,
} from "@/lib/client/plans";
import type { PlanToast, PlanToastKey } from "@/lib/client/plan-write-session";
import { usePlanWriteSession } from "./usePlanWriteSession";
import {
  anchorChoiceOf,
  anchorForChoice,
  flattenPlanSections,
  hideCompletedPlans,
  planAnchorsEqual,
  toDateKey,
  type Plan,
  type PlanAnchor,
  type PlanAnchorChoice,
  type PlansResponse,
} from "@/lib/shared/plans";
import { PlanRow } from "./PlanRow";
import { PlanDetailDialog } from "./PlanDetailDialog";
import { AnchorChips } from "./AnchorChips";
import { MiniCalendar } from "./MiniCalendar";
import {
  EmptyPlans,
  LabeledSection,
  OverdueSection,
  PickedAnchorToken,
} from "./PlanSections";
import { UnsortedPlans } from "./UnsortedPlans";
import { HideDoneToggle } from "./HideDoneToggle";

interface PlansPanelProps {
  /** Bumped on every open; re-opening the tab refetches. */
  openCount: number;
}

/**
 * The panel's wording for every toast the write session can pick. The session
 * decides *which* toast (a rule); the words are the panel's (`useI18n`).
 */
const PLAN_TOAST_MESSAGE_KEYS: Record<PlanToastKey, string> = {
  plan_saved: "Plan saved",
  save_failed: "Failed to save plan",
  update_failed: "Failed to update plan",
  reschedule_failed: "Failed to reschedule plan",
  rename_failed: "Failed to rename plan",
  create_failed: "Failed to create plan",
  name_taken: "A plan with that name already exists",
  plan_missing: "The plan no longer exists",
};

/**
 * Plans panel view — the Markdown files under `<dataRoot>/user-plans/`,
 * grouped into 过期 / 今天 / 本周 / 本月 / 即将到来 / 收件箱, plus the resident create input
 * that turns a title typed + Enter into one new plan file.
 *
 * Rows are a display line: clicking one opens the plan's detail dialog, where
 * the note is written and previewed as Markdown (600 ms debounce, Ctrl/Cmd+S to
 * save now), and where the save state and length of the note are reported. The
 * row itself keeps the completion checkbox and the hover actions (rename /
 * re-schedule / copy path / delete). The panel reads the filesystem on open, on
 * window re-focus and on the manual refresh button; there is no polling and no
 * watcher (ADR-0006). The local date is computed here, in the browser, and sent
 * to the server.
 *
 * Every write carries the `mtime` the panel last saw. When that no longer
 * matches — an agent or another editor touched the file — the server answers
 * 409 and the row shows 「覆盖 / 重载到新位置」 instead of silently overwriting.
 *
 * The writes themselves — the debounce, the five requests, the conflict
 * lifecycle, the flush when the dialog closes or the panel goes away — are
 * performed by `usePlanWriteSession`; this component translates its own events
 * into that session's intents and renders the situation it reports back. See
 * `lib/client/plan-write-session.ts` for the rules (#78, #79).
 */
export function PlansPanel({ openCount }: PlansPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [title, setTitle] = useState("");
  // The anchor the next typed plan will get. "today" is the zero-friction
  // default the pointer starts on; the chips move it. Resolved against the
  // browser's local day here, in render — the server never picks a date.
  const [anchorChoice, setAnchorChoice] = useState<PlanAnchorChoice>("today");
  // A day / week / month picked on the mini calendar. It overrides the chip
  // choice until a chip is clicked again, and is what the list highlights.
  const [pickedAnchor, setPickedAnchor] = useState<PlanAnchor | null>(null);
  // Which row's re-schedule chip menu is open (at most one).
  const [reschedulePath, setReschedulePath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The scrollable list, so a calendar pick can bring its rows into view.
  const listRef = useRef<HTMLDivElement>(null);
  // The input is disabled while a create is in flight and a disabled control
  // cannot take focus, so the caret is restored once the re-enable has been
  // committed — by the effect below, not by the request handler.
  const refocusPending = useRef(false);

  // What the next typed plan will be anchored to: a mini-calendar pick wins
  // over the one-tap chip choice until a chip is clicked again.
  const today = toDateKey(new Date());
  const newPlanAnchor = pickedAnchor ?? anchorForChoice(anchorChoice, today);
  // A calendar pick that no chip names (a day a year out, say) still has to
  // be visible in the create area, or the user cannot tell where it will land.
  const pickedIsCustom =
    pickedAnchor !== null && anchorChoiceOf(pickedAnchor, today) === null;

  /**
   * Read the list into the panel's own state. `spinner` is the visible read
   * (the panel's 「加载中」 and its error surface); `bypassCache` drops the
   * server's mtime cache (the manual refresh button). Returns the plans the
   * write session reasons about, or `null` when the read failed — the error is
   * already on screen, so the session is told nothing.
   */
  const readPlans = useCallback(
    async ({
      spinner,
      bypassCache,
    }: {
      spinner: boolean;
      bypassCache: boolean;
    }): Promise<Plan[] | null> => {
      if (spinner) setLoading(true);
      try {
        const fresh = await fetchPlans(toDateKey(new Date()), bypassCache);
        setData(fresh);
        setError(null);
        return flattenPlanSections(fresh.sections);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        if (spinner) setLoading(false);
      }
    },
    [],
  );

  /** Replace one plan in the list with the version the server just returned. */
  const applyPlan = useCallback((plan: Plan) => {
    setData((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            sections: prev.sections.map((section) => ({
              ...section,
              plans: section.plans.map((item) => (item.path === plan.path ? plan : item)),
            })),
          },
    );
  }, []);

  /** Show the toast the session asked for, in the panel's own words. */
  const notify = useCallback(
    ({ key, level, description }: PlanToast) => {
      toast.show({ kind: level, message: t(PLAN_TOAST_MESSAGE_KEYS[key]), description });
    },
    [t, toast],
  );

  /**
   * A create settled: landed → the box is cleared and the caret comes back, so
   * the next one can be recorded straight away; refused → what was typed stays
   * where it is and the toast says why.
   */
  const handleCreateSettled = useCallback((ok: boolean) => {
    if (ok) setTitle("");
    refocusPending.current = true;
  }, []);

  // The write session owns the situation and performs every effect; everything
  // below is the panel reading that situation and translating its events into
  // intents. The two halves it does not own are handed over: the list state
  // (`readPlans` / `applyPlan`) and the wording of the toasts.
  const {
    target,
    draft,
    saveStatus,
    conflict: pendingConflict,
    creating,
    openPlan,
    closeDialog,
    noteEdited,
    saveNow,
    toggleDone,
    reschedule: reschedulePlan,
    rename: renamePlan,
    createSubmitted,
    planRemoved,
    resolveConflict,
    dismissConflict,
    refresh,
  } = usePlanWriteSession({
    readPlans,
    applyPlan,
    notify,
    openCount,
    onCreateSettled: handleCreateSettled,
  });

  /**
   * The refused write waiting for an answer on a given surface, for a given
   * plan: the conflict belongs to the plan that triggered it *and* to the place
   * it was triggered from (#51).
   */
  const pendingConflictFor = useCallback(
    (path: string, surface: PlanConflictSurface): PlanConflictState | null =>
      pendingConflict !== null &&
      pendingConflict.path === path &&
      planConflictSurface(pendingConflict.retry) === surface
        ? pendingConflict
        : null,
    [pendingConflict],
  );

  const copyPath = useCopyPath();

  const removePlan = useCallback(
    async (plan: Plan) => {
      const ok = await confirm({
        title: t("Delete plan?"),
        description: `${plan.title}\n${plan.absPath}\n\n${t("This deletes the plan file permanently.")}`,
        confirmLabel: t("Delete"),
        destructive: true,
      });
      if (!ok) return;
      try {
        await deletePlan(plan.path);
        toast.show({ kind: "success", message: t("Plan deleted") });
        // The file is gone for good: whatever pointed at it — the detail
        // dialog, a notice, a note still owed — stops pointing at it, and the
        // list is re-read. Deleting itself carries no `mtime` and cannot
        // conflict, so it is ordinary I/O and stays here.
        planRemoved(plan.path);
      } catch (err) {
        toast.show({
          kind: "error",
          message: t("Failed to delete plan"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [confirm, planRemoved, t, toast],
  );

  /**
   * Record the plan in the box. The chosen anchor was resolved against the
   * browser's local day when it was picked (chip click / calendar pick); the
   * server never picks a date for us. The session holds the in-flight latch for
   * the create, so two Enters in one keystroke still make one plan.
   */
  const submit = useCallback(() => {
    const value = title.trim();
    if (!value || creating) return;
    createSubmitted(value, newPlanAnchor);
  }, [creating, createSubmitted, newPlanAnchor, title]);

  /** Re-schedule a plan from its row's chips. The chip is resolved against the
   *  browser's today here on the client; whether that is actually a move (a
   *  chip the plan already sits on is not one) is the session's decision. */
  const reschedule = useCallback(
    (plan: Plan, choice: PlanAnchorChoice) => {
      reschedulePlan(plan, choice, today);
    },
    [reschedulePlan, today],
  );

  const toggleReschedule = useCallback((plan: Plan) => {
    setReschedulePath((prev) => (prev === plan.path ? null : plan.path));
  }, []);

  // The input is disabled while a create is in flight and a disabled control
  // cannot take focus, so the caret is restored once the re-enable has been
  // committed — by this effect, not by the request handler.
  useEffect(() => {
    if (creating || !refocusPending.current) return;
    refocusPending.current = false;
    inputRef.current?.focus();
  }, [creating]);

  const sections = useMemo(
    () => hideCompletedPlans(data?.sections ?? [], hideDone),
    [data, hideDone],
  );
  // Every loaded plan, click-free: the mini calendar counts its badges from
  // this list, so it never asks the server for anything of its own. Counts
  // include completed plans even when 「隐藏已完成」 filters them out of the
  // list — the badge answers "how full is this period", not "what does the
  // filtered list show" (ADR-0006: done plans stay on the record).
  const allPlans = useMemo(() => flattenPlanSections(data?.sections ?? []), [data]);
  // The plan behind the detail dialog, looked up from the *unfiltered* data on
  // every render: the header then shows the title and anchor the file has right
  // now, even after it was re-scheduled outside the panel, and 「隐藏已完成」
  // does not close the dialog on a plan the user just completed.
  const editingPlan = useMemo(
    () => (target === null ? null : (findPlan(data, target.path) ?? null)),
    [data, target],
  );
  // The overdue section hides completed-only plans, so a lone done past plan
  // must still fall through to the empty state instead of a blank panel.
  const hasVisible = sections.some((section) =>
    section.id === "overdue"
      ? section.plans.some((plan) => !plan.done)
      : section.plans.length > 0,
  );
  // `total` counts what is on the record, `visibleCount` what the list shows:
  // they differ only while 「隐藏已完成」 is on.
  const total = allPlans.length;
  const visibleCount = flattenPlanSections(sections).length;

  const renderRow = useCallback(
    (plan: Plan, showDate: boolean) => (
      <PlanRow
        key={plan.path}
        plan={plan}
        showDate={showDate}
        rescheduleOpen={reschedulePath === plan.path}
        activeChoice={anchorChoiceOf(plan.anchor, today)}
        anchorMatch={pickedAnchor !== null && planAnchorsEqual(plan.anchor, pickedAnchor)}
        // Only the conflicts this row can answer: a refused note save is
        // rendered by the dialog instead (#51).
        conflict={pendingConflictFor(plan.path, "row")}
        onOpen={() => openPlan(plan)}
        onToggleDone={() => void toggleDone(plan)}
        onToggleReschedule={() => toggleReschedule(plan)}
        onReschedule={(choice) => void reschedule(plan, choice)}
        onRename={(next) => void renamePlan(plan, next)}
        onResolveConflict={(choice) => void resolveConflict(choice)}
        onDismissConflict={dismissConflict}
        onCopyPath={() => void copyPath(plan.absPath)}
        onDelete={() => void removePlan(plan)}
      />
    ),
    [
      copyPath,
      dismissConflict,
      openPlan,
      pendingConflictFor,
      pickedAnchor,
      removePlan,
      renamePlan,
      reschedule,
      reschedulePath,
      resolveConflict,
      today,
      toggleDone,
      toggleReschedule,
    ],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          rowGap: 4,
          gap: 6,
          minHeight: 34,
          padding: "2px 4px 2px 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("Plans")}</span>
        {data !== null && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{visibleCount}</span>
        )}
        <span style={{ flex: 1 }} />
        <HideDoneToggle hidden={hideDone} onToggle={() => setHideDone((value) => !value)} />
        <RefreshIconButton onClick={() => refresh(true)} disabled={loading} />
      </div>

      <div style={{ padding: "8px 10px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 8px",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-dim)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            style={{ flexShrink: 0 }}
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <input
            ref={inputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              // Enter creates, the box stays put for the next one; Escape
              // abandons what was typed. `isComposing` lets the Enter that
              // commits an IME candidate (Chinese input) through untouched —
              // the same guard the chat input uses.
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              } else if (event.key === "Escape") {
                setTitle("");
              }
            }}
            placeholder={t("Record a plan; press Enter")}
            aria-label={t("New plan")}
            disabled={creating}
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              fontSize: 12,
              color: "var(--text)",
              background: "transparent",
              border: "none",
              outline: "none",
            }}
          />
        </div>

        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <AnchorChips
            activeChoice={anchorChoiceOf(newPlanAnchor, today)}
            onSelect={(choice) => {
              // A chip is an explicit anchor choice again: drop the calendar
              // pick so the two cannot disagree.
              setPickedAnchor(null);
              setAnchorChoice(choice);
            }}
          />
          {pickedIsCustom && pickedAnchor !== null && (
            <PickedAnchorToken anchor={pickedAnchor} onClear={() => setPickedAnchor(null)} />
          )}
        </div>
      </div>

      <MiniCalendar plans={allPlans} selected={newPlanAnchor} onSelect={setPickedAnchor} />

      <div
        ref={listRef}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 10px 24px" }}
      >
        {error !== null ? (
          <div style={{ padding: "8px 4px", fontSize: 12, color: "var(--error)" }}>
            <div>{t("Failed to load plans")}</div>
            <div style={{ marginTop: 4, color: "var(--text-dim)", wordBreak: "break-word" }}>{error}</div>
            <button
              type="button"
              onClick={() => refresh(true)}
              style={{
                marginTop: 8,
                padding: "3px 10px",
                fontSize: 11,
                color: "var(--text)",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                cursor: "pointer",
              }}
            >
              {t("Retry")}
            </button>
          </div>
        ) : data === null ? (
          <div style={{ padding: "8px 4px", fontSize: 12, color: "var(--text-dim)" }}>
            {t("Loading")}
          </div>
        ) : (
          <>
            {!hasVisible ? (
              <EmptyPlans total={total} />
            ) : (
              sections.map((section) =>
                section.id === "overdue" ? (
                  <OverdueSection
                    key={section.id}
                    plans={section.plans}
                    open={overdueOpen}
                    onToggle={() => setOverdueOpen((value) => !value)}
                    renderRow={renderRow}
                  />
                ) : (
                  <LabeledSection
                    key={section.id}
                    id={section.id}
                    plans={section.plans}
                    renderRow={renderRow}
                  />
                ),
              )
            )}
            {/* Files that are not plans are listed last, never hidden: the
                user has to see what the panel could not read (ADR-0006). */}
            <UnsortedPlans items={data.unsorted} />
          </>
        )}
      </div>

      {editingPlan !== null && (
        <PlanDetailDialog
          // Keyed by path so switching plans re-mounts it: the narrow-mode pane
          // choice and the measured width start fresh for the new plan.
          key={editingPlan.path}
          plan={editingPlan}
          draft={draft}
          saveStatus={saveStatus}
          conflict={pendingConflictFor(editingPlan.path, "dialog")}
          onChange={noteEdited}
          onSave={saveNow}
          onResolveConflict={resolveConflict}
          onDismissConflict={dismissConflict}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}

/** Look a plan up in a list payload by its plan-relative path. */
function findPlan(data: PlansResponse | null, path: string): Plan | undefined {
  return flattenPlanSections(data?.sections ?? []).find((plan) => plan.path === path);
}
