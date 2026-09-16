"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { RefreshIconButton } from "@/components/ui/RefreshIconButton";
import { useCopyPath } from "./useCopyPath";
import {
  createPlan,
  deletePlan,
  fetchPlans,
  PlanConflictError,
  updatePlan,
} from "@/lib/client/plans";
import { readPlanViewMode, writePlanViewMode } from "@/lib/client/plans-view-mode";
import {
  DEFAULT_PLAN_VIEW_MODE,
  anchorChoiceOf,
  anchorForChoice,
  hideCompletedPlans,
  orderPlansForTimeline,
  planAnchorsEqual,
  toDateKey,
  type Plan,
  type PlanAnchor,
  type PlanAnchorChoice,
  type PlanSectionId,
  type PlansResponse,
  type PlanViewMode,
} from "@/lib/shared/plans";
import { PlanRow, type PlanConflictState, type PlanSaveStatus } from "./PlanRow";
import { AnchorChips } from "./AnchorChips";
import { Chevron } from "./Chevron";
import { MiniCalendar } from "./MiniCalendar";
import { UnsortedPlans } from "./UnsortedPlans";
import { ViewModeSwitch } from "./ViewModeSwitch";
import { anchorDisplayText } from "./anchorText";

interface PlansPanelProps {
  /** Bumped on every open; re-opening the tab refetches. */
  openCount: number;
}

/** Which note editor is open, and the `mtime` its content was loaded at. */
interface EditorTarget {
  path: string;
  mtime: string;
}

/** A 409 waiting for the user's 「覆盖 / 重载到新位置」 answer. */
type PendingConflict = PlanConflictState & { path: string };

const AUTOSAVE_MS = 600;

/**
 * Plans panel view — the Markdown files under `<dataRoot>/user-plans/`,
 * grouped into 收件箱 / 过期 / 今天 / 即将到来, plus the resident create input
 * that turns a title typed + Enter into one new plan file.
 *
 * Rows carry the whole editing loop: expand to write a note (600 ms debounce,
 * Ctrl/Cmd+S to save now), a round checkbox for 完成, and hover actions to copy
 * the file path or delete the file. It reads the filesystem on open, on window
 * re-focus and on the manual refresh button; there is no polling and no watcher
 * (ADR-0006). The local date is computed here, in the browser, and sent to the
 * server.
 *
 * Every write carries the `mtime` the panel last saw. When that no longer
 * matches — an agent or another editor touched the file — the server answers
 * 409 and the row shows 「覆盖 / 重载到新位置」 instead of silently overwriting.
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
  // Appearance mode (紧凑 / 卡片 / 时间轴). Presentational only: it is restored
  // from localStorage after mount and never changes what is fetched, so
  // switching re-renders the data already on screen (ADR-0006).
  const [viewMode, setViewMode] = useState<PlanViewMode>(DEFAULT_PLAN_VIEW_MODE);
  const [title, setTitle] = useState("");
  // The anchor the next typed plan will get. "today" is the zero-friction
  // default the pointer starts on; the chips move it. Resolved against the
  // browser's local day here, in render — the server never picks a date.
  const [anchorChoice, setAnchorChoice] = useState<PlanAnchorChoice>("today");
  // A day / week / month picked on the mini calendar. It overrides the chip
  // choice until a chip is clicked again, and is what the list highlights.
  const [pickedAnchor, setPickedAnchor] = useState<PlanAnchor | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState<PlanSaveStatus>("saved");
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  // Which row's re-schedule chip menu is open (at most one).
  const [reschedulePath, setReschedulePath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The scrollable list, so a calendar pick can bring its rows into view.
  const listRef = useRef<HTMLDivElement>(null);
  // Latch for the in-flight create: `creating` is a state update, so two
  // Enter presses in the same tick would both read `false` and create twice.
  const creatingRef = useRef(false);
  // Same latch for a re-schedule: the move is a write, so a double-click must
  // not send two of them.
  const reschedulingRef = useRef(false);
  // The input is disabled while a create is in flight and a disabled control
  // cannot take focus, so the caret is restored once the re-enable has been
  // committed — by the effect below, not by the request handler.
  const refocusPending = useRef(false);

  // The editing loop reads and writes through refs: the debounce timer, the
  // unmount flush and the save callbacks must all see the *current* draft and
  // target, not the ones captured when they were created.
  const editorRef = useRef<EditorTarget | null>(null);
  const draftRef = useRef("");
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conflictRef = useRef<PendingConflict | null>(null);
  // Latest `flushNote` closure, for the retry-after-save and unmount flushes.
  const flushRef = useRef<(notify?: boolean) => Promise<void>>(async () => {});
  const retrySaveRef = useRef(false);

  // What the next typed plan will be anchored to: a mini-calendar pick wins
  // over the one-tap chip choice until a chip is clicked again.
  const today = toDateKey(new Date());
  const newPlanAnchor = pickedAnchor ?? anchorForChoice(anchorChoice, today);
  // A calendar pick that no chip names (a day a year out, say) still has to
  // be visible in the create area, or the user cannot tell where it will land.
  const pickedIsCustom =
    pickedAnchor !== null && anchorChoiceOf(pickedAnchor, today) === null;

  const setEditorTarget = useCallback((next: EditorTarget | null) => {
    editorRef.current = next;
    setEditing(next);
  }, []);

  const setPendingConflict = useCallback((next: PendingConflict | null) => {
    conflictRef.current = next;
    setConflict(next);
  }, []);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setData(await fetchPlans(toDateKey(new Date()), refresh));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Re-read the list without the spinner, for conflict resolution. */
  const reload = useCallback(async (): Promise<PlansResponse | null> => {
    try {
      const fresh = await fetchPlans(toDateKey(new Date()), true);
      setData(fresh);
      setError(null);
      return fresh;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  // Fetch whenever the view is opened, including a re-open of an already
  // mounted tab (openCount changes; the body may have stayed alive while the
  // panel was collapsed).
  useEffect(() => {
    if (openCount > 0) void load();
  }, [openCount, load]);

  // Opening the view also hands the keyboard to the entry input: recording a
  // plan is the panel's one action, and this is the same openCount-as-focus
  // handoff the BTW panel uses for `/btw`. It is what makes the palette's
  // "New plan" entry land the caret in the box.
  useEffect(() => {
    if (openCount > 0) inputRef.current?.focus();
  }, [openCount]);

  // …and when the window regains focus, which is the usual way to notice an
  // external editor's or the agent's change.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Restore the appearance mode after mount, never during render: the server
  // prerender has no localStorage, so reading it there would break hydration.
  useEffect(() => {
    setViewMode(readPlanViewMode());
  }, []);

  const changeViewMode = useCallback((mode: PlanViewMode) => {
    setViewMode(mode);
    writePlanViewMode(mode);
  }, []);

  // A calendar pick navigates the list: the rows on that anchor are marked by
  // `renderRow` below, and this brings the first of them into view. A pick is
  // explicit, so this never scrolls on its own (chip clicks do not navigate).
  useEffect(() => {
    if (pickedAnchor === null) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-plan-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [pickedAnchor]);

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

  const openEditor = useCallback(
    (plan: Plan) => {
      draftRef.current = plan.note;
      setDraft(plan.note);
      dirtyRef.current = false;
      setSaveStatus("saved");
      setEditorTarget({ path: plan.path, mtime: plan.mtime });
    },
    [setEditorTarget],
  );

  const closeEditor = useCallback(() => {
    setEditorTarget(null);
    draftRef.current = "";
    setDraft("");
    dirtyRef.current = false;
    setSaveStatus("saved");
  }, [setEditorTarget]);

  /**
   * Write the open note if it is dirty. A pending conflict blocks the write
   * until the user answers it, so a debounce that raced an external edit cannot
   * spin against the server.
   */
  const flushNote = useCallback(
    async (notify = false) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const target = editorRef.current;
      if (target === null || !dirtyRef.current) return;
      if (conflictRef.current !== null) return;
      if (savingRef.current) {
        // A save is already in flight; run again once it settles so nothing
        // typed during the round trip is left unwritten.
        retrySaveRef.current = true;
        return;
      }
      savingRef.current = true;
      setSaveStatus("saving");
      try {
        const plan = await updatePlan({
          path: target.path,
          note: draftRef.current,
          expectedMtime: target.mtime,
        });
        applyPlan(plan);
        // Only touch the shared editor state if the user is still on this row
        // — switching rows mid-save hands the draft to the new one.
        if (editorRef.current?.path === target.path) {
          dirtyRef.current = false;
          setEditorTarget({ path: plan.path, mtime: plan.mtime });
          setSaveStatus("saved");
        }
        if (notify) toast.show({ kind: "success", message: t("Plan saved") });
      } catch (err) {
        if (err instanceof PlanConflictError && err.code !== "name-taken") {
          setPendingConflict({
            path: target.path,
            code: err.code,
            movedTo: err.movedTo,
            retry: { kind: "note" },
          });
          if (editorRef.current?.path === target.path) setSaveStatus("unsaved");
        } else {
          if (editorRef.current?.path === target.path) setSaveStatus("error");
          toast.show({
            kind: "error",
            message: t("Failed to save plan"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        savingRef.current = false;
        if (retrySaveRef.current) {
          retrySaveRef.current = false;
          void flushRef.current();
        }
      }
    },
    [applyPlan, flushRef, setEditorTarget, setPendingConflict, t, toast],
  );

  // Keep the unmount flush pointing at the latest closure without re-running
  // it: a cleanup that flushes on every state change would save mid-typing.
  useEffect(() => {
    flushRef.current = flushNote;
  }, [flushNote]);
  useEffect(
    () => () => {
      void flushRef.current();
    },
    [],
  );

  const handleNoteChange = useCallback(
    (value: string) => {
      draftRef.current = value;
      setDraft(value);
      dirtyRef.current = true;
      setSaveStatus("unsaved");
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flushNote();
      }, AUTOSAVE_MS);
    },
    [flushNote],
  );

  const toggleExpand = useCallback(
    (plan: Plan) => {
      if (editorRef.current?.path === plan.path) {
        void flushNote();
        closeEditor();
        setPendingConflict(null);
        return;
      }
      // Switching rows saves the one being left first.
      void flushNote();
      setPendingConflict(null);
      openEditor(plan);
    },
    [closeEditor, flushNote, openEditor, setPendingConflict],
  );

  const toggleDone = useCallback(
    async (plan: Plan) => {
      const desired = !plan.done;
      try {
        const updated = await updatePlan({
          path: plan.path,
          done: desired,
          expectedMtime: plan.mtime,
        });
        applyPlan(updated);
        if (editorRef.current?.path === plan.path) {
          setEditorTarget({ path: updated.path, mtime: updated.mtime });
        }
      } catch (err) {
        if (err instanceof PlanConflictError && err.code !== "name-taken") {
          // Show the conflict where the user is looking, and remember that
          // 「覆盖」 must redo the toggle, not save a note.
          if (editorRef.current?.path !== plan.path) openEditor(plan);
          setPendingConflict({
            path: plan.path,
            code: err.code,
            movedTo: err.movedTo,
            retry: { kind: "done", done: desired },
          });
          return;
        }
        toast.show({
          kind: "error",
          message: t("Failed to update plan"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [applyPlan, openEditor, setEditorTarget, setPendingConflict, t, toast],
  );

  /** Put the completion state the user asked for on the file as it is now. */
  const saveDone = useCallback(
    async (path: string, done: boolean, mtime: string | undefined, force = false) => {
      const updated = await updatePlan({ path, done, expectedMtime: mtime, force });
      applyPlan(updated);
      if (editorRef.current?.path === updated.path) {
        setEditorTarget({ path: updated.path, mtime: updated.mtime });
      }
    },
    [applyPlan, setEditorTarget],
  );

  /**
   * Re-schedule a plan: a different anchor is a different path, so this is a
   * move (the server renames the file) and the list is re-read rather than
   * patched in place — the row changes section anyway.
   */
  const reschedule = useCallback(
    async (plan: Plan, choice: PlanAnchorChoice) => {
      if (reschedulingRef.current) return;
      // The chosen chip is resolved against the browser's today here on the
      // client; the server never picks a date for us. A chip the plan already
      // sits on is a no-op, not a write.
      const today = toDateKey(new Date());
      if (anchorChoiceOf(plan.anchor, today) === choice) {
        setReschedulePath(null);
        return;
      }
      reschedulingRef.current = true;
      const anchor = anchorForChoice(choice, today);
      try {
        const updated = await updatePlan({
          path: plan.path,
          anchor,
          expectedMtime: plan.mtime,
        });
        // A moved plan takes the open note editor with it.
        if (editorRef.current?.path === plan.path) {
          setEditorTarget({ path: updated.path, mtime: updated.mtime });
        }
        if (conflictRef.current?.path === plan.path) setPendingConflict(null);
        setReschedulePath(null);
        await reload();
      } catch (err) {
        if (err instanceof PlanConflictError && err.code === "name-taken") {
          // The target month already holds a plan of that name. Nothing was
          // written and there is nothing to overwrite, so just say so.
          toast.show({
            kind: "error",
            message: t("A plan with that name already exists"),
            description: err.target ?? undefined,
          });
          return;
        }
        if (err instanceof PlanConflictError && err.code !== "name-taken") {
          setPendingConflict({
            path: plan.path,
            code: err.code,
            movedTo: err.movedTo,
            retry: { kind: "anchor", anchor },
          });
          return;
        }
        toast.show({
          kind: "error",
          message: t("Failed to reschedule plan"),
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        reschedulingRef.current = false;
      }
    },
    [reload, setEditorTarget, setPendingConflict, t, toast],
  );

  const toggleReschedule = useCallback((plan: Plan) => {
    setReschedulePath((prev) => (prev === plan.path ? null : plan.path));
  }, []);

  const resolveConflict = useCallback(
    async (choice: "overwrite" | "reload") => {
      const pending = conflictRef.current;
      if (pending === null) return;

      if (choice === "overwrite") {
        try {
          if (pending.retry.kind === "done") {
            // `force` skips the guard, so no mtime is needed — and none of the
            // list's (stale) data has to be trusted.
            await saveDone(pending.path, pending.retry.done, undefined, true);
          } else if (pending.retry.kind === "anchor") {
            // Move the file as it is on disk to the anchor the user picked.
            const updated = await updatePlan({
              path: pending.path,
              anchor: pending.retry.anchor,
              force: true,
            });
            if (editorRef.current?.path === pending.path) {
              setEditorTarget({ path: updated.path, mtime: updated.mtime });
            }
            await reload();
          } else {
            const updated = await updatePlan({
              path: pending.path,
              note: draftRef.current,
              force: true,
            });
            dirtyRef.current = false;
            applyPlan(updated);
            if (editorRef.current?.path === updated.path) {
              setEditorTarget({ path: updated.path, mtime: updated.mtime });
              setSaveStatus("saved");
            }
          }
          setPendingConflict(null);
          // A 「覆盖」 of a completion toggle can still leave a dirty note behind.
          void flushNote();
        } catch (err) {
          toast.show({
            kind: "error",
            message: t("Failed to save plan"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      // 「重载」: re-read the list and follow the file — then re-apply what the
      // user was doing, so nothing they did is dropped. For a content change
      // (same path, fresher bytes) the disk version is the truth and the draft
      // is replaced by what is actually in the file.
      const fresh = await reload();
      const target = pending.code === "missing" ? pending.movedTo : pending.path;
      const found = target === null ? undefined : findPlan(fresh, target);
      if (!found) {
        // Gone for good (or the reload failed): keep the notice up, so 「覆盖」
        // is still there to recreate the file where it used to be.
        toast.show({ kind: "error", message: t("The plan no longer exists") });
        return;
      }
      const noteWasDirty = dirtyRef.current;
      setPendingConflict(null);

      // 1. The refused action, applied to the file as it is now.
      if (pending.retry.kind === "done") {
        try {
          await saveDone(found.path, pending.retry.done, found.mtime);
        } catch (err) {
          toast.show({
            kind: "error",
            message: t("Failed to update plan"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (pending.retry.kind === "anchor") {
        try {
          const updated = await updatePlan({
            path: found.path,
            anchor: pending.retry.anchor,
            expectedMtime: found.mtime,
          });
          if (editorRef.current?.path === pending.path) {
            setEditorTarget({ path: updated.path, mtime: updated.mtime });
          }
          await reload();
        } catch (err) {
          if (err instanceof PlanConflictError && err.code === "name-taken") {
            toast.show({
              kind: "error",
              message: t("A plan with that name already exists"),
              description: err.target ?? undefined,
            });
          } else {
            toast.show({
              kind: "error",
              message: t("Failed to reschedule plan"),
              description: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } else if (pending.code === "modified") {
        openEditor(found);
      }

      // 2. A moved plan takes the open editor with it. Only a note the user
      //    actually typed is written to the new path — the editor merely
      //    pointing at a plan is not a reason to rewrite it elsewhere. A
      //    re-schedule moved the editor itself in step 1.
      if (
        pending.retry.kind !== "anchor" &&
        pending.code === "missing" &&
        editorRef.current?.path === pending.path
      ) {
        setEditorTarget({ path: found.path, mtime: found.mtime });
        if (noteWasDirty) {
          dirtyRef.current = true;
          await flushNote();
        }
      }
    },
    [
      applyPlan,
      flushNote,
      openEditor,
      reload,
      saveDone,
      setEditorTarget,
      setPendingConflict,
      t,
      toast,
    ],
  );

  const dismissConflict = useCallback(() => {
    setPendingConflict(null);
    setSaveStatus(dirtyRef.current ? "unsaved" : "saved");
  }, [setPendingConflict]);

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
        if (editorRef.current?.path === plan.path) closeEditor();
        if (conflictRef.current?.path === plan.path) setPendingConflict(null);
        toast.show({ kind: "success", message: t("Plan deleted") });
        await load();
      } catch (err) {
        toast.show({
          kind: "error",
          message: t("Failed to delete plan"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [closeEditor, confirm, load, setPendingConflict, t, toast],
  );

  const submit = useCallback(async () => {
    const value = title.trim();
    if (!value || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      // The chosen anchor was resolved against the browser's local day when it
      // was picked (chip click / calendar pick); the server never picks a
      // date for us.
      await createPlan({ title: value, anchor: newPlanAnchor });
      setTitle("");
      await load();
    } catch (err) {
      toast.show({
        kind: "error",
        message: t("Failed to create plan"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      creatingRef.current = false;
      // Keep the flow going: clear the box, keep the caret, record another.
      refocusPending.current = true;
      setCreating(false);
    }
  }, [newPlanAnchor, title, load, toast, t]);

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
  const allPlans = useMemo(
    () => data?.sections.flatMap((section) => section.plans) ?? [],
    [data],
  );
  // 时间轴 mode's single ordered axis. It reuses the *same* filtered sections
  // the other two modes render, flattened — so the switch behaves identically
  // in every mode and only the arrangement differs (ADR-0006). Order within
  // the sections is irrelevant: `orderPlansForTimeline` re-sorts.
  const timelinePlans = useMemo(
    () => orderPlansForTimeline(sections.flatMap((section) => section.plans), today),
    [sections, today],
  );
  // The overdue section hides completed-only plans, so a lone done past plan
  // must still fall through to the empty state instead of a blank panel.
  const hasVisible = sections.some((section) =>
    section.id === "overdue"
      ? section.plans.some((plan) => !plan.done)
      : section.plans.length > 0,
  );
  const total = data?.sections.reduce((n, section) => n + section.plans.length, 0) ?? 0;
  const visibleCount = sections.reduce((n, section) => n + section.plans.length, 0);

  const renderRow = useCallback(
    (plan: Plan, showDate: boolean) => (
      <PlanRow
        key={plan.path}
        plan={plan}
        variant={viewMode === "cards" ? "cards" : "compact"}
        showDate={showDate}
        expanded={editing?.path === plan.path}
        rescheduleOpen={reschedulePath === plan.path}
        activeChoice={anchorChoiceOf(plan.anchor, today)}
        selected={pickedAnchor !== null && planAnchorsEqual(plan.anchor, pickedAnchor)}
        draft={draft}
        saveStatus={saveStatus}
        conflict={conflict?.path === plan.path ? conflict : null}
        onToggleExpand={() => toggleExpand(plan)}
        onToggleDone={() => void toggleDone(plan)}
        onToggleReschedule={() => toggleReschedule(plan)}
        onReschedule={(choice) => void reschedule(plan, choice)}
        onNoteChange={handleNoteChange}
        onSaveNote={() => void flushNote(true)}
        onResolveConflict={(choice) => void resolveConflict(choice)}
        onDismissConflict={dismissConflict}
        onCopyPath={() => void copyPath(plan.absPath)}
        onDelete={() => void removePlan(plan)}
      />
    ),
    [
      conflict,
      copyPath,
      dismissConflict,
      draft,
      editing,
      flushNote,
      handleNoteChange,
      pickedAnchor,
      removePlan,
      reschedule,
      reschedulePath,
      resolveConflict,
      saveStatus,
      today,
      toggleDone,
      toggleExpand,
      toggleReschedule,
      viewMode,
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
        <ViewModeSwitch value={viewMode} onChange={changeViewMode} />
        <button
          type="button"
          onClick={() => setHideDone((value) => !value)}
          aria-pressed={hideDone}
          style={{
            flexShrink: 0,
            padding: "2px 7px",
            fontSize: 10.5,
            color: hideDone ? "var(--text)" : "var(--text-muted)",
            background: hideDone ? "var(--bg-selected)" : "transparent",
            border: "1px solid var(--border)",
            borderRadius: 5,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {t(hideDone ? "Show completed" : "Hide completed")}
        </button>
        <RefreshIconButton onClick={() => void load(true)} disabled={loading} />
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
                void submit();
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
              onClick={() => void load(true)}
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
            {viewMode === "timeline" ? (
              timelinePlans.length === 0 ? (
                <EmptyPlans total={total} />
              ) : (
                <TimelineList plans={timelinePlans} renderRow={renderRow} />
              )
            ) : !hasVisible ? (
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
    </div>
  );
}

/** The create anchor when it is *not* one of the one-tap chips — a day, week
 *  or month picked on the mini calendar. It shows what the next plan will use
 *  and gives a way back to the chips (which is also what clears the list
 *  highlight the pick added). */
function PickedAnchorToken({ anchor, onClear }: { anchor: PlanAnchor; onClear: () => void }) {
  const { t, locale } = useI18n();
  const text = anchorDisplayText(anchor, t, locale);
  if (text === null) return null;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 4px 2px 7px",
        fontSize: 10.5,
        color: "var(--text)",
        background: "var(--bg-selected)",
        border: "1px solid var(--accent)",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 9.5, color: "var(--text-dim)" }}>{t("New plan anchor")}</span>
      <span style={{ fontFamily: "var(--font-mono)" }}>{text}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={t("Clear")}
        title={t("Clear")}
        style={{
          display: "inline-flex",
          padding: 1,
          color: "var(--text-dim)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </span>
  );
}

/** Look a plan up in a list payload by its plan-relative path. */
function findPlan(data: PlansResponse | null, path: string): Plan | undefined {
  return data?.sections.flatMap((section) => section.plans).find((plan) => plan.path === path);
}

type RenderRow = (plan: Plan, showDate: boolean) => React.ReactNode;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "4px 4px",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-muted)",
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </div>
  );
}

/** The shared empty state: with no plans at all it invites a first one, with
 *  plans on the record but none visible it says they are all done. */
function EmptyPlans({ total }: { total: number }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        padding: "32px 12px",
        textAlign: "center",
        fontSize: 12,
        color: "var(--text-dim)",
      }}
    >
      {total > 0 ? t("All plans are completed") : t("No plans yet")}
    </div>
  );
}

/**
 * 时间轴 mode: no sections, one continuous axis. The inbox is pinned at the top
 * behind its own label — a plan without a time must not drift out of sight —
 * and every anchored plan below it is laid out past → today → future by
 * `orderPlansForTimeline`. Anchored rows always show their date so the axis
 * can be read; inbox rows have no time to show.
 */
function TimelineList({ plans, renderRow }: { plans: Plan[]; renderRow: RenderRow }) {
  const { t } = useI18n();
  const inbox = plans.filter((plan) => plan.anchor.kind === "inbox");
  const anchored = plans.filter((plan) => plan.anchor.kind !== "inbox");
  return (
    <>
      {inbox.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <SectionLabel>{t("plans.inbox")}</SectionLabel>
          {inbox.map((plan) => renderRow(plan, false))}
        </div>
      )}
      {anchored.map((plan) => renderRow(plan, true))}
    </>
  );
}

function LabeledSection({
  id,
  plans,
  renderRow,
}: {
  id: Exclude<PlanSectionId, "overdue">;
  plans: Plan[];
  renderRow: RenderRow;
}) {
  const { t } = useI18n();
  if (plans.length === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <SectionLabel>{t(SECTION_LABEL_KEY[id])}</SectionLabel>
      {plans.map((plan) => renderRow(plan, id === "upcoming"))}
    </div>
  );
}

const SECTION_LABEL_KEY: Record<Exclude<PlanSectionId, "overdue">, string> = {
  inbox: "plans.inbox",
  today: "Today",
  week: "plans.week",
  month: "plans.month",
  upcoming: "Upcoming",
};

/**
 * Overdue plans live behind one collapsed row. The row counts and lists only
 * the *open* ones — a plan with a past anchor that is already done is history,
 * not a reminder, and would otherwise read "0 open" while showing items.
 */
function OverdueSection({
  plans,
  open,
  onToggle,
  renderRow,
}: {
  plans: Plan[];
  open: boolean;
  onToggle: () => void;
  renderRow: RenderRow;
}) {
  const { t } = useI18n();
  const openPlans = plans.filter((plan) => !plan.done);
  if (openPlans.length === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "4px 4px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: 11,
          fontWeight: 600,
          textAlign: "left",
        }}
      >
        <Chevron open={open} />
        <span>{t("{n} overdue open plans", { n: openPlans.length })}</span>
      </button>
      {open && openPlans.map((plan) => renderRow(plan, true))}
    </div>
  );
}

