"use client";

// The wiring for the plan write session: the one place in this feature that
// touches `setTimeout`, `fetch`, the window's `focus` event and the unmount.
// `lib/client/plan-write-session` stays pure and `PlansPanel` stays a view
// because everything that has to *happen* lands here (#79).
//
// The shape is the module's: the situation lives in a ref (React state is only
// its projection, because the debounce callback and the async write callbacks
// must read the *current* draft rather than a stale closure), the intents are
// one-line wrappers around `dispatch`, and the effects are performed against a
// `PlanWritePort` whose list half is the panel's own list state (`readPlans` /
// `applyPlan`) while its timer half is this hook's.
//
// What it deliberately does not own: the list data (`data` / `loading` /
// `error`), the create box's text, the selected chips, which re-schedule menu is
// open, and the DOM refs (including the caret restore). Those stay in the
// panel: it reads the list *through* `readPlans` and patches it through
// `applyPlan`, so neither side grows a second copy of the other's truth.
//
// Three triggers the panel used to own live here now, because each is "the
// situation changed outside the panel": the panel was opened (`openCount`), the
// window regained focus, and the manual refresh button (`refresh`). All three
// are a visible read of the list.
//
// One deliberate behaviour change, and the only one: a note typed *during* a
// write's round trip now survives it. Slice 1's module keeps the editor dirty
// when the settled draft is not the one that went out and sends the newer one;
// the old panel cleared the dirty flag unconditionally on success (issue #80),
// which turned its own retry machinery into a no-op and silently dropped those
// keystrokes while still reporting 「已保存」. Everything else — copy, timing,
// which surface a conflict appears on — is the same as before.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPlan as createPlanRequest, updatePlan } from "@/lib/client/plans";
import {
  createPlanWriteState,
  reducePlanWriteSession,
  runPlanWriteEffects,
  type PlanPendingConflict,
  type PlanToast,
  type PlanWriteDispatch,
  type PlanWriteIntent,
  type PlanWritePort,
  type PlanWriteSaveStatus,
  type PlanWriteState,
} from "@/lib/client/plan-write-session";
import type { Plan, PlanAnchor, PlanAnchorChoice } from "@/lib/shared/plans";

export interface PlanWriteSessionOptions {
  /**
   * Read the plan list and hand it to the panel's own list state. `spinner` is
   * the visible read (the panel's 「加载中」 and its error surface);
   * `bypassCache` drops the server's mtime cache (the manual refresh button).
   * Returns the plans the session reasons about, or `null` when the read failed
   * — the panel has already put the error on screen.
   */
  readPlans: (options: { spinner: boolean; bypassCache: boolean }) => Promise<Plan[] | null>;
  /** Patch one plan into the list with the version the server just returned. */
  applyPlan: (plan: Plan) => void;
  /** Show a toast. The wording is the panel's `useI18n`; which toast is the
   *  session's. */
  notify: (toast: PlanToast) => void;
  /** Bumped on every open; re-opening the panel re-reads the list. */
  openCount: number;
  /** A create settled: `true` landed, `false` was refused. The panel clears the
   *  entry box and restores the caret, and keeps what was typed on failure. */
  onCreateSettled?: (ok: boolean) => void;
}

/**
 * The write session as the panel sees it: the projection of the situation it
 * renders, plus the intents it can express. Every method is stable, so a row
 * memoized on them does not re-render when only the situation moves.
 */
export interface PlanWriteSession {
  /** The plan the detail dialog is on, and the `mtime` its note was read at. */
  target: { path: string; mtime: string } | null;
  /** The note as typed right now. */
  draft: string;
  saveStatus: PlanWriteSaveStatus;
  /** The one 409 waiting for 「覆盖 / 重载」, or `null`. */
  conflict: PlanPendingConflict | null;
  /** A create is in flight (the entry box is disabled while it is). */
  creating: boolean;
  openPlan: (plan: Plan) => void;
  closeDialog: () => void;
  noteEdited: (note: string) => void;
  saveNow: () => void;
  toggleDone: (plan: Plan) => void;
  /** `today` is the browser's local day, resolved by the panel. */
  reschedule: (plan: Plan, choice: PlanAnchorChoice, today: string) => void;
  rename: (plan: Plan, title: string) => void;
  createSubmitted: (title: string, anchor: PlanAnchor) => void;
  planRemoved: (path: string) => void;
  resolveConflict: (choice: "overwrite" | "reload") => void;
  dismissConflict: () => void;
  /** A visible read of the list (the manual refresh button; `bypassCache` is
   *  what that button asks for, and is required so a plain read cannot be
   *  silently confused with a cache-busting one). */
  refresh: (bypassCache: boolean) => void;
}

/**
 * Own the write session for one open plans panel: its situation, the loop that
 * performs its effects, and the real dependencies those effects run against.
 */
export function usePlanWriteSession(options: PlanWriteSessionOptions): PlanWriteSession {
  const [state, setState] = useState<PlanWriteState>(createPlanWriteState);
  // The situation's real home: the debounce callback and every write outcome
  // land outside React's render cycle, and they must all read the same, latest
  // situation. `state` above is the projection the panel renders.
  const stateRef = useRef(state);
  // The latest options, read through a ref so the port (built once) always
  // calls the panel's current callbacks instead of the ones from first render.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const publish = useCallback((next: PlanWriteState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // The real dependency bag: the five writes over HTTP, the two list reads
  // (which the panel owns), the debounce, and the toasts. A note or a
  // completion is patched into the list from the plan the server returned; a
  // move and a rename re-read it instead, because the rows are keyed by path.
  const port = useMemo<PlanWritePort>(
    () => ({
      writeNote: async (input) => {
        const plan = await updatePlan({
          path: input.path,
          note: input.note,
          expectedMtime: input.expectedMtime ?? undefined,
          force: input.force,
        });
        optionsRef.current.applyPlan(plan);
        return plan;
      },
      writeDone: async (input) => {
        const plan = await updatePlan({
          path: input.path,
          done: input.done,
          expectedMtime: input.expectedMtime ?? undefined,
          force: input.force,
        });
        optionsRef.current.applyPlan(plan);
        return plan;
      },
      writeAnchor: ({ path, anchor, expectedMtime, force }) =>
        updatePlan({ path, anchor, expectedMtime: expectedMtime ?? undefined, force }),
      writeTitle: ({ path, title, expectedMtime, force }) =>
        updatePlan({ path, title, expectedMtime: expectedMtime ?? undefined, force }),
      createPlan: async (input) => {
        try {
          const plan = await createPlanRequest(input);
          optionsRef.current.onCreateSettled?.(true);
          return plan;
        } catch (err) {
          optionsRef.current.onCreateSettled?.(false);
          throw err;
        }
      },
      reloadList: () => optionsRef.current.readPlans({ spinner: false, bypassCache: true }),
      refreshList: () => optionsRef.current.readPlans({ spinner: true, bypassCache: false }),
      scheduleSave: (delayMs) => {
        cancelTimer();
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          void dispatchRef.current({ type: "autosave_fired" });
        }, delayMs);
      },
      cancelSave: cancelTimer,
      toast: (toast) => optionsRef.current.notify(toast),
    }),
    [cancelTimer],
  );

  // The loop's self-reference: an effect's outcome is fed back in by calling
  // this again, so the ref is what lets the port and the loop refer to the one
  // dispatch closure. It is also what keeps this hook's methods stable. The
  // placeholder is never called — the assignment two lines down happens during
  // the first render, before any event, timer or request can reach it.
  const dispatchRef = useRef<PlanWriteDispatch>(() => undefined);
  const dispatch = useCallback<PlanWriteDispatch>(
    (intent) => {
      const reduction = reducePlanWriteSession(stateRef.current, intent);
      publish(reduction.state);
      return runPlanWriteEffects(reduction.effects, port, dispatchRef.current);
    },
    [port, publish],
  );
  dispatchRef.current = dispatch;

  /** A visible read: the panel shows the spinner and owns the error, and the
   *  session hears about it only when it produced a list. */
  const runVisibleRead = useCallback(async (bypassCache: boolean) => {
    const plans = await optionsRef.current.readPlans({ spinner: true, bypassCache });
    if (plans !== null) {
      await dispatchRef.current({ type: "list_refreshed", plans, kind: "refresh" });
    }
  }, []);

  // Opening the panel (including re-opening a mounted but collapsed one) reads
  // the list.
  const { openCount } = options;
  useEffect(() => {
    if (openCount > 0) void runVisibleRead(false);
  }, [openCount, runVisibleRead]);

  // …and so does the window regaining focus, which is the usual way to notice
  // an external editor's or the agent's change (ADR-0006: no polling, no
  // watcher).
  useEffect(() => {
    const onFocus = () => void runVisibleRead(false);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [runVisibleRead]);

  // The panel going away flushes what is owed: closing is saving, and a note
  // typed during a round trip carries its own payload, so it lands even though
  // there is no editor left to read it from.
  useEffect(
    () => () => {
      void dispatchRef.current({ type: "close_dialog" });
    },
    [],
  );

  const send = useCallback((intent: PlanWriteIntent) => {
    void dispatchRef.current(intent);
  }, []);

  const openPlan = useCallback((plan: Plan) => send({ type: "open_plan", plan }), [send]);
  const closeDialog = useCallback(() => send({ type: "close_dialog" }), [send]);
  const noteEdited = useCallback((note: string) => send({ type: "note_edited", note }), [send]);
  const saveNow = useCallback(() => send({ type: "save_now" }), [send]);
  const toggleDone = useCallback((plan: Plan) => send({ type: "toggle_done", plan }), [send]);
  const reschedule = useCallback(
    (plan: Plan, choice: PlanAnchorChoice, today: string) =>
      send({ type: "reschedule", plan, choice, today }),
    [send],
  );
  const rename = useCallback(
    (plan: Plan, title: string) => send({ type: "rename", plan, title }),
    [send],
  );
  const createSubmitted = useCallback(
    (title: string, anchor: PlanAnchor) => send({ type: "create_submitted", title, anchor }),
    [send],
  );
  const planRemoved = useCallback((path: string) => send({ type: "plan_removed", path }), [send]);
  const resolveConflict = useCallback(
    (choice: "overwrite" | "reload") => send({ type: "conflict_answered", choice }),
    [send],
  );
  const dismissConflict = useCallback(() => send({ type: "conflict_dismissed" }), [send]);
  const refresh = useCallback(
    (bypassCache: boolean) => void runVisibleRead(bypassCache),
    [runVisibleRead],
  );

  return {
    target: state.target,
    draft: state.draft,
    saveStatus: state.saveStatus,
    conflict: state.conflict,
    creating: state.creating,
    openPlan,
    closeDialog,
    noteEdited,
    saveNow,
    toggleDone,
    reschedule,
    rename,
    createSubmitted,
    planRemoved,
    resolveConflict,
    dismissConflict,
    refresh,
  };
}
