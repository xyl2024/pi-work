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
  planConflictSurface,
  planWriteFailure,
  updatePlan,
  type PlanConflictState,
  type PlanConflictSurface,
  type PlanWriteFailure,
} from "@/lib/client/plans";
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
import { PlanRow, type PlanSaveStatus } from "./PlanRow";
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
 * Rows are a display line: clicking one opens the plan's detail dialog, where
 * the note is written and previewed as Markdown (600 ms debounce, Ctrl/Cmd+S to
 * save now), and where the save state and length of the note are reported. The
 * row itself keeps the completion checkbox and the hover actions (re-schedule /
 * copy path / delete). The panel reads the filesystem on open, on window
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

  /**
   * Hand the detail dialog a plan: its note becomes the draft, and it opens as
   * the one edited plan. The target carries the `mtime` the note was read at,
   * which every write guards on.
   */
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
   * Read the list. `refresh` bypasses the server's mtime cache (the manual
   * refresh button).
   *
   * A refresh is also when external drift becomes visible: if the plan behind
   * the open dialog is no longer in the list (moved or deleted outside the
   * panel), the dialog closes and says so rather than letting the user keep
   * typing into a file that is not there. `reload` below deliberately does
   * *not* do this — it runs inside conflict resolution, where the dialog is
   * following the file to its new path.
   */
  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        const fresh = await fetchPlans(toDateKey(new Date()), refresh);
        setData(fresh);
        setError(null);
        const target = editorRef.current;
        if (target !== null && findPlan(fresh, target.path) === undefined) {
          closeEditor();
          setPendingConflict(null);
          toast.show({ kind: "error", message: t("The plan no longer exists") });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [closeEditor, setPendingConflict, t, toast],
  );

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

  // A calendar pick navigates the list: the rows on that anchor are marked by
  // `renderRow` below (a data attribute, not a visual state), and this brings
  // the first of them into view. A pick is explicit, so this never scrolls on
  // its own (chip clicks do not navigate).
  useEffect(() => {
    if (pickedAnchor === null) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-plan-anchor-match="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [pickedAnchor]);

  /**
   * If the open note editor sits on `fromPath`, re-point it at the plan the
   * server just returned. A re-schedule renames the file, so the editor has to
   * follow; a note or completion write keeps the path and only refreshes the
   * `mtime` the next write guards on. Either way this is "the editor follows the
   * plan it is editing", and it happens after every successful write.
   */
  const adoptEditor = useCallback(
    (fromPath: string, plan: Plan) => {
      if (editorRef.current?.path === fromPath) {
        setEditorTarget({ path: plan.path, mtime: plan.mtime });
      }
    },
    [setEditorTarget],
  );

  /**
   * The one way the panel reports a re-schedule that landed on a plan already
   * using that name: nothing was written, so there is nothing to overwrite or
   * reload — the occupied path is the whole message.
   */
  const reportNameTaken = useCallback(
    (failure: Extract<PlanWriteFailure, { kind: "name-taken" }>) => {
      toast.show({
        kind: "error",
        message: t("A plan with that name already exists"),
        description: failure.target ?? undefined,
      });
    },
    [t, toast],
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
          adoptEditor(target.path, plan);
          setSaveStatus("saved");
        }
        if (notify) toast.show({ kind: "success", message: t("Plan saved") });
      } catch (err) {
        const failure = planWriteFailure(err);
        if (failure.kind === "conflict") {
          setPendingConflict({
            path: target.path,
            code: failure.code,
            movedTo: failure.movedTo,
            retry: { kind: "note" },
          });
          if (editorRef.current?.path === target.path) setSaveStatus("unsaved");
        } else {
          // A note save never renames, so a name collision cannot land here;
          // if one somehow did it would read as an ordinary failure.
          if (editorRef.current?.path === target.path) setSaveStatus("error");
          toast.show({
            kind: "error",
            message: t("Failed to save plan"),
            description: failure.message,
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
    [adoptEditor, applyPlan, flushRef, setPendingConflict, t, toast],
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

  /**
   * Clicking a row opens the plan's detail dialog. Opening another plan saves
   * the one being left first — the dialog is the only editor, so switching
   * targets is switching rows, and nothing typed is dropped.
   */
  const openDialog = useCallback(
    (plan: Plan) => {
      if (editorRef.current?.path === plan.path) return;
      void flushNote();
      setPendingConflict(null);
      openEditor(plan);
    },
    [flushNote, openEditor, setPendingConflict],
  );

  /**
   * Closing saves: Esc, the backdrop, the ✕ and switching plans all flush the
   * note and then close. There is no 「要保存吗」 question anywhere — the only
   * thing that can block the write is a conflict, and dismissing the dialog is
   * an answer to it.
   */
  const closeDialog = useCallback(() => {
    void flushNote();
    closeEditor();
    setPendingConflict(null);
  }, [closeEditor, flushNote, setPendingConflict]);

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
        adoptEditor(plan.path, updated);
      } catch (err) {
        const failure = planWriteFailure(err);
        if (failure.kind === "conflict") {
          // The conflict belongs on the row the checkbox is on: 「覆盖」 must redo
          // the toggle, not save a note, so nothing here opens an editor.
          setPendingConflict({
            path: plan.path,
            code: failure.code,
            movedTo: failure.movedTo,
            retry: { kind: "done", done: desired },
          });
          return;
        }
        toast.show({
          kind: "error",
          message: t("Failed to update plan"),
          description: failure.message,
        });
      }
    },
    [adoptEditor, applyPlan, setPendingConflict, t, toast],
  );

  /** Put the completion state the user asked for on the file as it is now. */
  const saveDone = useCallback(
    async (path: string, done: boolean, mtime: string | undefined, force = false) => {
      const updated = await updatePlan({ path, done, expectedMtime: mtime, force });
      applyPlan(updated);
      adoptEditor(path, updated);
    },
    [adoptEditor, applyPlan],
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
        adoptEditor(plan.path, updated);
        if (conflictRef.current?.path === plan.path) setPendingConflict(null);
        setReschedulePath(null);
        await reload();
      } catch (err) {
        const failure = planWriteFailure(err);
        if (failure.kind === "name-taken") {
          // The target month already holds a plan of that name. Nothing was
          // written and there is nothing to overwrite, so just say so.
          reportNameTaken(failure);
          return;
        }
        if (failure.kind === "conflict") {
          setPendingConflict({
            path: plan.path,
            code: failure.code,
            movedTo: failure.movedTo,
            retry: { kind: "anchor", anchor },
          });
          return;
        }
        toast.show({
          kind: "error",
          message: t("Failed to reschedule plan"),
          description: failure.message,
        });
      } finally {
        reschedulingRef.current = false;
      }
    },
    [adoptEditor, reload, reportNameTaken, setPendingConflict, t, toast],
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
            adoptEditor(pending.path, updated);
            await reload();
          } else {
            const updated = await updatePlan({
              path: pending.path,
              note: draftRef.current,
              force: true,
            });
            dirtyRef.current = false;
            applyPlan(updated);
            if (editorRef.current?.path === updated.path) setSaveStatus("saved");
            adoptEditor(pending.path, updated);
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
          adoptEditor(pending.path, updated);
          await reload();
        } catch (err) {
          const failure = planWriteFailure(err);
          if (failure.kind === "name-taken") reportNameTaken(failure);
          else
            toast.show({
              kind: "error",
              message: t("Failed to reschedule plan"),
              description: failure.message,
            });
        }
      } else if (pending.code === "modified") {
        openEditor(found);
      }

      // 2. A moved plan takes the open editor with it. Only a note the user
      //    actually typed is written to the new path — the editor merely
      //    pointing at a plan is not a reason to rewrite it elsewhere. A
      //    re-schedule moved the editor itself in step 1.
      if (pending.retry.kind !== "anchor" && pending.code === "missing") {
        const editorOnOldPath = editorRef.current?.path === pending.path;
        adoptEditor(pending.path, found);
        if (editorOnOldPath && noteWasDirty) {
          dirtyRef.current = true;
          await flushNote();
        }
      }
    },
    [
      adoptEditor,
      applyPlan,
      flushNote,
      openEditor,
      reload,
      reportNameTaken,
      saveDone,
      setPendingConflict,
      t,
      toast,
    ],
  );

  const dismissConflict = useCallback(() => {
    setPendingConflict(null);
    setSaveStatus(dirtyRef.current ? "unsaved" : "saved");
  }, [setPendingConflict]);

  /**
   * The refused write waiting for an answer on a given surface, for a given
   * plan: the conflict belongs to the plan that triggered it *and* to the place
   * it was triggered from (#51).
   */
  const pendingConflictFor = useCallback(
    (path: string, surface: PlanConflictSurface): PlanConflictState | null =>
      conflict !== null &&
      conflict.path === path &&
      planConflictSurface(conflict.retry) === surface
        ? conflict
        : null,
    [conflict],
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
  const allPlans = useMemo(() => flattenPlanSections(data?.sections ?? []), [data]);
  // The plan behind the detail dialog, looked up from the *unfiltered* data on
  // every render: the header then shows the title and anchor the file has right
  // now, even after it was re-scheduled outside the panel, and 「隐藏已完成」
  // does not close the dialog on a plan the user just completed.
  const editingPlan = useMemo(
    () => (editing === null ? null : (findPlan(data, editing.path) ?? null)),
    [data, editing],
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
        onOpen={() => openDialog(plan)}
        onToggleDone={() => void toggleDone(plan)}
        onToggleReschedule={() => toggleReschedule(plan)}
        onReschedule={(choice) => void reschedule(plan, choice)}
        onResolveConflict={(choice) => void resolveConflict(choice)}
        onDismissConflict={dismissConflict}
        onCopyPath={() => void copyPath(plan.absPath)}
        onDelete={() => void removePlan(plan)}
      />
    ),
    [
      copyPath,
      dismissConflict,
      openDialog,
      pendingConflictFor,
      pickedAnchor,
      removePlan,
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
          onChange={handleNoteChange}
          onSave={() => void flushNote(true)}
          onResolveConflict={(choice) => void resolveConflict(choice)}
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
