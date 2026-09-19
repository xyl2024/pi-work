// The plan write session: how the Plans panel gets content into files.
//
// Five writes go through here — the note, the completion checkbox, a
// re-schedule (which moves the file), a rename (which renames it in place) and
// the create box — and they share one machine: a draft, an optimistic `mtime`
// guard, a 409, its classification, the 「覆盖 / 重载到新位置」 notice, and the
// overwrite / reload that answers it, plus the 600 ms debounce behind the note.
// Deletion is deliberately *not* here: it carries no `mtime` and cannot
// conflict, so it is ordinary I/O (ADR-0006).
//
// Shape, following `lib/shared/session-events.ts` (ADR-0007's precedent): a
// situation type, a closed intent union, a closed effect union, and one pure
// entry point
//
//   reducePlanWriteSession(state, intent) → { state, effects }
//
// "What the user pressed, and what the file is now" goes in; "what the screen
// shows and who owns the DOM" stays in the panel. Nothing here reads a clock, a
// timer, the DOM or the network: the 600 ms debounce is a *decision* this
// module makes and emits as `schedule_save(600)`; the `setTimeout`, the
// requests and the toasts are the wiring.
//
// There is no `default:` branch anywhere in the intent switch, and both unions
// carry a compile-time completeness assertion, so adding a sixth write without
// taking a position on it is a `tsc` error rather than a silent passthrough.
//
// Two rules are worth naming up front, because they are the ones that used to
// live only in the reader's head:
//
//   • One write flies at a time. The latch is a single slot, not the three
//     hand-copied flags it replaces (`savingRef` / `creatingRef` /
//     `reschedulingRef`), and every one of the five goes through it.
//   • A note typed while a write is flying is never lost. The deferred note
//     carries its own payload, so closing the dialog or switching plans while a
//     round trip is in the air still writes what the user typed — which is what
//     `flushNote`'s own comment promises ("run again once it settles so nothing
//     typed during the round trip is left unwritten") and what its unconditional
//     `dirtyRef.current = false` fails to deliver: a draft that moved on during
//     the round trip keeps the editor dirty, and the newer draft goes out. The
//     panel drift this pins down is recorded as issue #80, so the wiring slice
//     picks it up deliberately instead of copying it back in.
//
// Where it lives: `lib/client`, not `lib/shared` — a deliberate, narrow reading
// of ADR-0003 rule 1 (see the ADR's 修订, #78). The reason is the *input*: this
// machine's situation is made of client-transport facts (a 409 arrived, its
// `code` was `missing`), while `lib/shared/plans.ts` is the domain contract the
// server shares — the file-name / anchor rules. The module still obeys the
// substance of the rule: no React, no DOM, no `fetch`, no server import, no
// store, and it is unit-testable through the one pure seam below.
//
// The second seam is `runPlanWriteEffects`: the loop that performs the effects
// against a dependency bag (the five real writes, the two list reads, the
// debounce and the toast), so the *ordering* knowledge — save on close, re-run
// a note write typed during a round trip, never retry after a 409 — is driven by
// fakes in tests instead of by the browser. Same shape as
// `lib/server/turn/orchestrate.ts`'s `runTurn(spec, factory)`.

import {
  anchorChoiceOf,
  anchorForChoice,
  type Plan,
  type PlanAnchor,
  type PlanAnchorChoice,
  type PlanConflictCode,
} from "@/lib/shared/plans";

// ── Vocabulary (moved here from `lib/client/plans.ts`) ────────────────────
//
// The conflict code, the retry kinds, the classification of a refused write
// and the surface its notice belongs on are all *this machine's* words. The
// fetch module keeps only the HTTP client, and re-exports these so the panel
// and the existing tests still read them from there.

/**
 * The 409 the panel must answer with 「覆盖 / 重载到新位置」 rather than an error
 * toast: `modified` = the file changed under us, `missing` = it was moved,
 * renamed or deleted. `movedTo` is the server's best guess at the new path.
 *
 * `name-taken` is different: a re-schedule landed on a plan that already exists
 * there. Nothing was written, so there is nothing to overwrite or reload — the
 * panel just reports it (`target` is the occupied path).
 */
export class PlanConflictError extends Error {
  code: PlanConflictCode;
  movedTo: string | null;
  target: string | null;

  constructor(
    code: PlanConflictCode,
    message: string,
    movedTo: string | null,
    target: string | null = null,
  ) {
    super(message);
    this.code = code;
    this.movedTo = movedTo;
    this.target = target;
  }
}

/** The conflict codes that are a *question*: `name-taken` is a plain report. */
export type PlanWriteConflictCode = Exclude<PlanConflictCode, "name-taken">;

/**
 * What a failed plan write means for the panel. Three shapes, because the
 * panel answers them three different ways:
 *
 * - `name-taken`  — nothing was written and there is nothing to overwrite, so
 *                   the panel only reports the occupied `target`.
 * - `conflict`    — the panel's view was stale; the user answers 「覆盖 / 重载」
 *                   and the refused action is retried from `retry`.
 * - `error`       — anything else (network, 500, unreadable file): a toast.
 *
 * Deciding this is the panel's most repeated branch, so it lives here once,
 * next to the error it is classifying, instead of as an `instanceof` dance at
 * every write site.
 */
export type PlanWriteFailure =
  | { kind: "name-taken"; target: string | null; message: string }
  | {
      kind: "conflict";
      code: PlanWriteConflictCode;
      movedTo: string | null;
      message: string;
    }
  | { kind: "error"; message: string };

/** The failure shapes the write session answers itself; a conflict is the
 *  user's decision, not an error. */
export type PlanWriteError = Exclude<PlanWriteFailure, { kind: "conflict" }>;

/** Classify a rejected `updatePlan` / `deletePlan` call. Never throws. */
export function planWriteFailure(err: unknown): PlanWriteFailure {
  if (err instanceof PlanConflictError) {
    const { code, movedTo, target, message } = err;
    if (code === "name-taken") return { kind: "name-taken", target, message };
    return { kind: "conflict", code, movedTo, message };
  }
  return { kind: "error", message: err instanceof Error ? err.message : String(err) };
}

/**
 * What 「覆盖」 must redo after the user answers a conflict: the note save, the
 * completion state the checkbox was aiming for, the re-schedule the chip asked
 * for, or the rename the row's title input asked for. Carried as data instead
 * of re-derived from the list, which is stale exactly when a conflict happens.
 */
export type PlanConflictRetry =
  | { kind: "note" }
  | { kind: "done"; done: boolean }
  | { kind: "anchor"; anchor: PlanAnchor }
  | { kind: "rename"; title: string };

/** A write the server refused with 409 because the panel's view was stale. */
export interface PlanConflictState {
  /** `modified` = content changed under us, `missing` = moved / renamed / gone. */
  code: PlanWriteConflictCode;
  /** Where the same-titled plan lives now, when the server could tell. */
  movedTo: string | null;
  /** The action that was refused. */
  retry: PlanConflictRetry;
}

/** The one conflict that can be waiting for an answer, and the plan it is
 *  about. A newer conflict *replaces* the older one: the panel must never show
 *  two places asking for the same decision. */
export interface PlanPendingConflict extends PlanConflictState {
  /** The path the refused write started on — not necessarily the path the plan
   *  has now (`movedTo` is where it went). */
  path: string;
}

/**
 * Where a 409's 「覆盖 / 重载」 banner belongs: at the place that triggered it.
 *
 * A note save is asked for in the detail dialog, so its banner goes there. A
 * completion toggle, a re-schedule or a rename is asked for on the row, and the
 * dialog can only edit the note — pulling the user into it would lose the intent
 * they actually expressed.
 */
export type PlanConflictSurface = "dialog" | "row";

export function planConflictSurface(retry: PlanConflictRetry): PlanConflictSurface {
  return retry.kind === "note" ? "dialog" : "row";
}

// ── Situation ────────────────────────────────────────────────────────────

/** The note's save state as the dialog's footer reports it. */
export type PlanWriteSaveStatus = "saved" | "unsaved" | "saving" | "error";

/** The kind of write that can be in flight. `create` is the fifth one, held by
 *  `creating` below (its in-flight state is also what disables the entry
 *  input; the two slots can never be held at once). */
export type PlanWriteKind = "note" | "done" | "anchor" | "rename";

/** The one write in flight. One slot for the whole machine: a write is a round
 *  trip against one file, and "no second one while one is flying" is the rule
 *  that used to be written out three times. */
export interface PlanWriteInFlight {
  kind: PlanWriteKind;
  /** The path the write started on — a re-schedule or a rename moves it. */
  path: string;
  /** A note write asked for by Ctrl/Cmd+S: report it when it lands. */
  notify: boolean;
  /** The user's 「覆盖」 answer: skips the `mtime` guard, answers a conflict. */
  force: boolean;
  /** A note write's exact payload, so the settle can tell whether the draft
   *  moved on while the round trip was in the air. `null` for the other three. */
  note: string | null;
}

/**
 * A note write that was asked for while another write was flying, kept with its
 * own payload. This is why closing the dialog or switching plans mid-flight
 * does not drop what was typed: the payload does not depend on the editor still
 * being open when the in-flight write settles.
 */
export interface PlanDeferredNoteWrite {
  /** The path the note was typed against. If the write that settles moved the
   *  file, this is re-pointed at the new path. */
  path: string;
  note: string;
  expectedMtime: string;
}

/**
 * The whole situation of the write machine for one open panel: which plan the
 * dialog is on, what the user has typed, whether a write is flying, what is
 * waiting for an answer. It holds no list data, no DOM and no HTTP.
 */
export interface PlanWriteState {
  /** The plan the detail dialog has open, and the `mtime` its note was read
   *  at — the value every guarded write carries. */
  target: { path: string; mtime: string } | null;
  /** The note as the user has it right now. */
  draft: string;
  /** The draft holds something the file does not. */
  dirty: boolean;
  saveStatus: PlanWriteSaveStatus;
  /** The debounce is armed (the wiring holds a live `setTimeout`). */
  autosaveScheduled: boolean;
  /** The write in flight, if any. */
  writeInFlight: PlanWriteInFlight | null;
  /** A note write owed once the flying one settles. */
  deferredNote: PlanDeferredNoteWrite | null;
  /** The one 409 waiting for 「覆盖 / 重载」. */
  conflict: PlanPendingConflict | null;
  /** The create is in flight. */
  creating: boolean;
}

/** The closed, empty situation. */
export function createPlanWriteState(): PlanWriteState {
  return {
    target: null,
    draft: "",
    dirty: false,
    saveStatus: "saved",
    autosaveScheduled: false,
    writeInFlight: null,
    deferredNote: null,
    conflict: null,
    creating: false,
  };
}

// ── Intents (what the outside tells the machine) ─────────────────────────

/** Which read produced a list: the visible one (spinner, the panel's `load`)
 *  or the silent one conflict resolution uses. They differ in what they do
 *  with the answer, not in how they read. */
export type PlanListReadKind = "refresh" | "reload";

/**
 * Everything that can happen to the write machine. Closed union, `snake_case`
 * discriminants, no `default:` in the reducer: a sixth write has to be added
 * here *and* answered below, or nothing compiles.
 */
export type PlanWriteIntent =
  /** Open the detail dialog on a plan (switching plans flushes the one left). */
  | { type: "open_plan"; plan: Plan }
  /** Close it: the note is flushed, there is no 「要保存吗」 question. */
  | { type: "close_dialog" }
  /** A keystroke in the note: arm (or re-arm) the debounce. */
  | { type: "note_edited"; note: string }
  /** Ctrl/Cmd+S: write now and say so when it lands. */
  | { type: "save_now" }
  /** The debounce fired. */
  | { type: "autosave_fired" }
  /** The row's completion checkbox. */
  | { type: "toggle_done"; plan: Plan }
  /** A re-schedule chip. `today` is the browser's local day, resolved here. */
  | { type: "reschedule"; plan: Plan; choice: PlanAnchorChoice; today: string }
  /** The row's rename input committed a new title. */
  | { type: "rename"; plan: Plan; title: string }
  /** The create box: a title plus the anchor the panel already resolved. */
  | { type: "create_submitted"; title: string; anchor: PlanAnchor }
  /** A plan was deleted: whatever pointed at it stops pointing at it. */
  | { type: "plan_removed"; path: string }
  /** A list read came back. */
  | { type: "list_refreshed"; plans: readonly Plan[]; kind: PlanListReadKind }
  /** One of the five writes landed. */
  | { type: "write_succeeded"; plan: Plan }
  /** One of them was refused with a 409 the user has to answer. */
  | {
      type: "write_conflicted";
      code: PlanWriteConflictCode;
      movedTo: string | null;
      retry: PlanConflictRetry;
      message: string;
    }
  /** One of them failed for any other reason. */
  | { type: "write_failed"; failure: PlanWriteError }
  /** 「覆盖」 or 「重载到新位置」. */
  | { type: "conflict_answered"; choice: "overwrite" | "reload" }
  /** The notice is dismissed without an answer. */
  | { type: "conflict_dismissed" };

/** Every intent name, enumerable at runtime and in declaration order. */
export const PLAN_WRITE_INTENT_TYPES = [
  "open_plan",
  "close_dialog",
  "note_edited",
  "save_now",
  "autosave_fired",
  "toggle_done",
  "reschedule",
  "rename",
  "create_submitted",
  "plan_removed",
  "list_refreshed",
  "write_succeeded",
  "write_conflicted",
  "write_failed",
  "conflict_answered",
  "conflict_dismissed",
] as const satisfies readonly PlanWriteIntent["type"][];

// ── Effects (what the machine tells the outside to do) ───────────────────

/** Which toast to show. The *wording* is the panel's (`useI18n`); the choice
 *  of which one is this module's — that half of the branch is a rule. */
export type PlanToastKey =
  | "plan_saved"
  | "save_failed"
  | "update_failed"
  | "reschedule_failed"
  | "rename_failed"
  | "create_failed"
  | "name_taken"
  | "plan_missing";

export interface PlanToast {
  key: PlanToastKey;
  /** The panel's toast component takes a success / error level; only
   *  `plan_saved` is a success, and it is derived here rather than repeated at
   *  every toast site. */
  level: "success" | "error";
  /** The server's own message, or the occupied path for `name_taken`. */
  description?: string;
}

/** The one place a toast is built, so the level can never disagree with the
 *  key. */
function planToast(key: PlanToastKey, description?: string): PlanToast {
  const level = key === "plan_saved" ? "success" : "error";
  return description === undefined ? { key, level } : { key, level, description };
}

/**
 * Everything the outside is asked to do. Closed union, exhaustively switched
 * by `runPlanWriteEffects`.
 *
 * Deliberately absent: refocusing an input (DOM, the panel's) and patching the
 * list in place (the panel's list state). `write_succeeded` carries the plan the
 * server returned back into the machine; the panel decides what its list does
 * with it.
 */
export type PlanWriteEffect =
  | {
      kind: "write_note";
      path: string;
      note: string;
      /** `null` only with `force`. */
      expectedMtime: string | null;
      force: boolean;
    }
  | {
      kind: "write_done";
      path: string;
      done: boolean;
      expectedMtime: string | null;
      force: boolean;
    }
  | {
      kind: "write_anchor";
      path: string;
      anchor: PlanAnchor;
      expectedMtime: string | null;
      force: boolean;
    }
  | {
      kind: "write_title";
      path: string;
      title: string;
      expectedMtime: string | null;
      force: boolean;
    }
  | { kind: "write_create"; title: string; anchor: PlanAnchor }
  /** Re-read the list without a spinner; conflict resolution follows the file. */
  | { kind: "reload_list" }
  /** Re-read it with the spinner (a create or a delete landed). */
  | { kind: "refresh_list" }
  /** Arm (or re-arm) the debounce. The 600 ms is this module's policy. */
  | { kind: "schedule_save"; delayMs: number }
  /** Disarm it (the note is being written, or the dialog closed). */
  | { kind: "cancel_save" }
  | { kind: "toast"; toast: PlanToast };

/** Every effect kind, enumerable at runtime and in declaration order. */
export const PLAN_WRITE_EFFECT_KINDS = [
  "write_note",
  "write_done",
  "write_anchor",
  "write_title",
  "write_create",
  "reload_list",
  "refresh_list",
  "schedule_save",
  "cancel_save",
  "toast",
] as const satisfies readonly PlanWriteEffect["kind"][];

// Compile-time completeness, the way `lib/shared/session-events.ts` proves its
// protocol: a member added to either union without landing in the matching list
// is an error here, and so is a listed name the union does not have.

type AssertTrue<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Every intent is enumerable: adding one without listing it fails to compile. */
export type PlanWriteIntentTypesAreComplete = AssertTrue<
  Equal<PlanWriteIntent["type"], (typeof PLAN_WRITE_INTENT_TYPES)[number]>
>;

/** Every effect is enumerable: adding one without listing it fails to compile. */
export type PlanWriteEffectKindsAreComplete = AssertTrue<
  Equal<PlanWriteEffect["kind"], (typeof PLAN_WRITE_EFFECT_KINDS)[number]>
>;

// ── The debounce: this module's policy, not the wiring's ─────────────────

/** How long the note waits after the last keystroke. Emitted with every
 *  `schedule_save`; the `setTimeout` itself belongs to the wiring. */
export const PLAN_AUTOSAVE_MS = 600;

// ── The reducer ──────────────────────────────────────────────────────────

export interface PlanWriteReduction {
  state: PlanWriteState;
  effects: PlanWriteEffect[];
}

/**
 * The one entry point: the current situation plus what just happened in, the
 * next situation plus what to do about it out. Pure — no React, no DOM, no
 * timers, no `fetch`, no toast, no store write, no clock (`today` arrives with
 * the intent).
 */
export function reducePlanWriteSession(
  state: PlanWriteState,
  intent: PlanWriteIntent,
): PlanWriteReduction {
  switch (intent.type) {
    // ── The dialog ───────────────────────────────────────────────────────
    case "open_plan": {
      const plan = intent.plan;
      // Already on this plan: the panel is only re-rendering, nothing moves.
      if (state.target?.path === plan.path) return { state, effects: [] };
      const effects: PlanWriteEffect[] = [];
      // Opening another plan saves the one being left: the dialog is the only
      // editor, so switching targets is the same flush as closing.
      let next = cancelAutosave(state, effects);
      // The flush is attempted before the notice is cleared, exactly as the
      // panel orders it: a conflict blocks it, and switching rows is itself an
      // answer to that notice.
      next = requestNoteWrite(next, effects, false);
      next = openPlanInEditor(next, plan);
      next = withState(next, { conflict: null });
      return { state: next, effects };
    }
    case "close_dialog": {
      const effects: PlanWriteEffect[] = [];
      let next = cancelAutosave(state, effects);
      next = requestNoteWrite(next, effects, false);
      next = closeEditor(next);
      // Dismissing the dialog is an answer to a conflict: the notice goes with
      // the editor it belonged to.
      next = withState(next, { conflict: null });
      return { state: next, effects };
    }
    case "note_edited": {
      let next = withState(state, {
        draft: intent.note,
        dirty: true,
        saveStatus: "unsaved",
        autosaveScheduled: true,
      });
      // A keystroke that lands while a write is flying is a note write owed:
      // registering it now is what keeps it safe if the dialog is closed before
      // the round trip settles. A deferral for *another* plan is left alone —
      // this keystroke's own debounce covers the plan on screen.
      const target = next.target;
      if (
        target !== null &&
        isWriteBusy(next) &&
        (next.deferredNote === null || next.deferredNote.path === target.path)
      ) {
        next = withState(next, {
          deferredNote: {
            path: target.path,
            note: intent.note,
            expectedMtime: target.mtime,
          },
        });
      }
      // Every keystroke re-arms the debounce; the wiring resets its timer.
      return { state: next, effects: [{ kind: "schedule_save", delayMs: PLAN_AUTOSAVE_MS }] };
    }
    case "save_now":
    case "autosave_fired": {
      const effects: PlanWriteEffect[] = [];
      // The timer has fired: it is no longer armed. Ctrl/Cmd+S cancels it.
      const next =
        intent.type === "autosave_fired"
          ? withState(state, { autosaveScheduled: false })
          : cancelAutosave(state, effects);
      return { state: requestNoteWrite(next, effects, intent.type === "save_now"), effects };
    }

    // ── The row's four writes ────────────────────────────────────────────
    case "toggle_done": {
      const plan = intent.plan;
      if (isWriteBusy(state)) return { state, effects: [] };
      return started(
        state,
        { kind: "done", done: !plan.done },
        { path: plan.path, expectedMtime: plan.mtime, force: false },
      );
    }
    case "reschedule": {
      const { plan, choice, today } = intent;
      if (isWriteBusy(state)) return { state, effects: [] };
      // A chip the plan already sits on is not a move: re-scheduling *is*
      // moving the file, and an empty move is not a write.
      if (anchorChoiceOf(plan.anchor, today) === choice) return { state, effects: [] };
      return started(
        state,
        { kind: "anchor", anchor: anchorForChoice(choice, today) },
        { path: plan.path, expectedMtime: plan.mtime, force: false },
      );
    }
    case "rename": {
      const { plan, title } = intent;
      if (isWriteBusy(state)) return { state, effects: [] };
      return started(
        state,
        { kind: "rename", title },
        { path: plan.path, expectedMtime: plan.mtime, force: false },
      );
    }
    case "create_submitted": {
      const title = intent.title.trim();
      // The create latch is what makes two Enters in one keystroke produce one
      // plan, not two.
      if (title === "" || isWriteBusy(state)) return { state, effects: [] };
      return {
        state: withState(state, { creating: true }),
        effects: [{ kind: "write_create", title, anchor: intent.anchor }],
      };
    }

    // ── The list ─────────────────────────────────────────────────────────
    case "plan_removed": {
      const effects: PlanWriteEffect[] = [];
      let next = state;
      if (next.target?.path === intent.path) {
        // Deleted for good: nothing to flush to, so the editor just closes.
        next = cancelAutosave(next, effects);
        next = closeEditor(next);
      }
      if (next.conflict?.path === intent.path) next = withState(next, { conflict: null });
      if (next.deferredNote?.path === intent.path) next = withState(next, { deferredNote: null });
      effects.push({ kind: "refresh_list" });
      return { state: next, effects };
    }
    case "list_refreshed": {
      if (intent.kind === "reload") return resolveConflictFromList(state, intent.plans);
      // A visible read is also when external drift becomes visible: the plan
      // behind the open dialog is gone (moved or deleted outside the panel), so
      // the dialog closes and says so instead of letting the user keep typing
      // into a file that is not there.
      const target = state.target;
      if (target !== null && !intent.plans.some((plan) => plan.path === target.path)) {
        const effects: PlanWriteEffect[] = [];
        let next = cancelAutosave(state, effects);
        next = closeEditor(next);
        next = withState(next, { conflict: null });
        effects.push({ kind: "toast", toast: planToast("plan_missing") });
        return { state: next, effects };
      }
      return { state, effects: [] };
    }

    // ── How a write ended ────────────────────────────────────────────────
    case "write_succeeded":
      return reduceWriteSucceeded(state, intent.plan);
    case "write_conflicted":
      return reduceWriteConflicted(state, intent);
    case "write_failed":
      return reduceWriteFailed(state, intent.failure);

    // ── Answering a conflict ─────────────────────────────────────────────
    case "conflict_answered": {
      const pending = state.conflict;
      if (pending === null) return { state, effects: [] };
      // The latch is the one slot for "a write is flying": answering while
      // another one is would hand that write's outcome to the wrong action. The
      // notice stays up and the answer can be given again in a moment.
      if (isWriteBusy(state)) return { state, effects: [] };

      if (intent.choice === "reload") {
        // Re-read the list and follow the file; `list_refreshed` finishes the
        // job with what is actually on disk.
        return { state, effects: [{ kind: "reload_list" }] };
      }

      // 「覆盖」: redo the refused action against the file as it is, skipping the
      // guard. The notice stays up until that write lands.
      return started(state, retryRequest(pending.retry, state.draft), {
        path: pending.path,
        expectedMtime: null,
        force: true,
      });
    }
    case "conflict_dismissed": {
      if (state.conflict === null) return { state, effects: [] };
      return {
        state: withState(state, {
          conflict: null,
          saveStatus: state.dirty ? "unsaved" : "saved",
        }),
        effects: [],
      };
    }
  }
}

// ── The three endings ────────────────────────────────────────────────────

function reduceWriteSucceeded(state: PlanWriteState, plan: Plan): PlanWriteReduction {
  const effects: PlanWriteEffect[] = [];
  const inFlight = state.writeInFlight;
  const fromPath = inFlight?.path ?? null;
  const wasCreating = state.creating;
  let next = clearWrite(state);

  if (wasCreating) {
    // The new plan's title is cleared by the panel and its list patched from
    // the returned plan; the spinner read is the machine's.
    effects.push({ kind: "refresh_list" });
    return { state: settleDeferred(next, effects, null), effects };
  }

  const kind = inFlight?.kind ?? null;
  if (kind === "note" && next.target !== null && next.target.path === fromPath) {
    if (inFlight?.force !== true && next.draft !== inFlight?.note) {
      // The user typed while this write was flying: what is on disk is not what
      // the editor holds, so the editor stays dirty and the newer draft goes out
      // below. (This is what keeps a round trip from eating keystrokes.)
      next = withState(next, { dirty: true, saveStatus: "unsaved" });
    } else {
      next = withState(next, { dirty: false, saveStatus: "saved" });
    }
  }
  if (fromPath !== null) next = adoptEditor(next, fromPath, plan);

  if (kind === "note" && inFlight?.notify === true) {
    effects.push({ kind: "toast", toast: planToast("plan_saved") });
  }
  // A move or a rename repaths the file: the list's rows are keyed by path, so
  // re-read it rather than patch it in place.
  if (kind === "anchor" || kind === "rename") effects.push({ kind: "reload_list" });

  if (inFlight?.force === true && next.conflict !== null && next.conflict.path === fromPath) {
    next = withState(next, { conflict: null });
    // A 「覆盖」 of a completion toggle / re-schedule / rename can still leave a
    // dirty note behind: the conflict was blocking the flush, and it is gone.
    next = requestNoteWrite(next, effects, false);
  } else if (
    (kind === "anchor" || kind === "rename") &&
    next.conflict !== null &&
    next.conflict.path === fromPath
  ) {
    // A move / rename that landed answers a notice that was up for the same
    // plan: it is the very action the notice asked about.
    next = withState(next, { conflict: null });
  }

  return {
    state: settleDeferred(
      next,
      effects,
      fromPath === null
        ? null
        : { path: fromPath, kind, note: inFlight?.note ?? null, plan },
    ),
    effects,
  };
}

function reduceWriteConflicted(
  state: PlanWriteState,
  intent: Extract<PlanWriteIntent, { type: "write_conflicted" }>,
): PlanWriteReduction {
  const inFlight = state.writeInFlight;
  const effects: PlanWriteEffect[] = [];
  const fromPath = inFlight?.path ?? null;
  let next = clearWrite(state);
  if (fromPath === null) return { state: next, effects };

  if (inFlight?.force === true) {
    // 「覆盖」 skips the guard, so it cannot be refused the same way twice; if a
    // 409 still arrives, the panel keeps the notice it already has up.
    effects.push({ kind: "toast", toast: planToast("save_failed", intent.message) });
    return { state: next, effects };
  }

  // The notice blocks further automatic writes for *this* plan until the user
  // answers, so a note owed for it is dropped (the draft it stands for is still
  // in the editor, and resolution re-applies it). A note owed for another plan
  // is untouched.
  if (next.deferredNote?.path === fromPath) next = withState(next, { deferredNote: null });
  next = withState(next, {
    conflict: {
      path: fromPath,
      code: intent.code,
      movedTo: intent.movedTo,
      retry: intent.retry,
    },
  });
  if (intent.retry.kind === "note" && next.target !== null && next.target.path === fromPath) {
    next = withState(next, { saveStatus: "unsaved" });
  }
  return { state: next, effects };
}

function reduceWriteFailed(
  state: PlanWriteState,
  failure: PlanWriteError,
): PlanWriteReduction {
  const effects: PlanWriteEffect[] = [];
  const inFlight = state.writeInFlight;
  const fromPath = inFlight?.path ?? null;
  const wasCreating = state.creating;
  let next = clearWrite(state);

  if (wasCreating) {
    effects.push({ kind: "toast", toast: planToast("create_failed", failure.message) });
    return { state: settleDeferred(next, effects, null), effects };
  }

  if (inFlight?.force === true) {
    // A refused 「覆盖」: the notice stays up (the panel's overwrite branch
    // reports it as a save failure whatever the refused action was).
    effects.push({ kind: "toast", toast: planToast("save_failed", failure.message) });
  } else {
    switch (inFlight?.kind) {
      case "note":
        if (next.target !== null && next.target.path === fromPath) {
          next = withState(next, { saveStatus: "error" });
        }
        effects.push({ kind: "toast", toast: planToast("save_failed", failure.message) });
        break;
      case "done":
        effects.push({ kind: "toast", toast: planToast("update_failed", failure.message) });
        break;
      case "anchor":
        effects.push({
          kind: "toast",
          toast:
            failure.kind === "name-taken"
              ? planToast("name_taken", failure.target ?? undefined)
              : planToast("reschedule_failed", failure.message),
        });
        break;
      case "rename":
        effects.push({
          kind: "toast",
          toast:
            failure.kind === "name-taken"
              ? planToast("name_taken", failure.target ?? undefined)
              : planToast("rename_failed", failure.message),
        });
        break;
      case undefined:
        break;
    }
  }

  // A failed write changed nothing on disk, so a note owed for the same plan is
  // still owed (its captured `mtime` stays valid).
  return {
    state: settleDeferred(
      next,
      effects,
      fromPath === null
        ? null
        : { path: fromPath, kind: inFlight?.kind ?? null, note: inFlight?.note ?? null, plan: null },
    ),
    effects,
  };
}

/**
 * 「重载到新位置」 in its second half: the list has been re-read, so follow the
 * file and re-apply what the user was doing — nothing they did is dropped.
 *
 * For a content change (same path, fresher bytes) the disk version is the truth
 * and the draft is replaced by what is actually in the file. For a file that
 * moved, the editor follows it *and* a note the user had actually typed is
 * written to the new path — a moved plan must not eat the keystrokes made while
 * the conflict was up.
 */
function resolveConflictFromList(
  state: PlanWriteState,
  plans: readonly Plan[],
): PlanWriteReduction {
  const pending = state.conflict;
  if (pending === null) return { state, effects: [] };

  const targetPath = pending.code === "missing" ? pending.movedTo : pending.path;
  const found =
    targetPath === null ? undefined : plans.find((plan) => plan.path === targetPath);
  if (found === undefined) {
    // Gone for good (or the read failed): keep the notice up, so 「覆盖」 is
    // still there to recreate the file where it used to be.
    return { state, effects: [{ kind: "toast", toast: planToast("plan_missing") }] };
  }

  const noteWasDirty = state.dirty;
  const effects: PlanWriteEffect[] = [];
  let next = withState(state, { conflict: null });

  // 1. The refused action, applied to the file as it is now.
  if (pending.retry.kind === "note" && pending.code === "modified") {
    // Same path, fresher bytes: the disk wins and the draft becomes what the
    // file actually says.
    next = openPlanInEditor(next, found);
  } else {
    const request = retryRequest(pending.retry, state.draft);
    const write = planWriteFor(request, {
      path: found.path,
      expectedMtime: found.mtime,
      force: false,
    });
    next = startWrite(next, write.inFlight);
    effects.push(write.effect);
  }

  // 2. A moved plan takes the open editor with it. Only a note the user
  //    actually typed is written to the new path — the editor merely pointing
  //    at a plan is not a reason to rewrite it elsewhere. A re-schedule moved
  //    the editor itself in step 1.
  if (pending.retry.kind !== "anchor" && pending.code === "missing") {
    const editorOnOldPath = next.target?.path === pending.path;
    next = adoptEditor(next, pending.path, found);
    if (editorOnOldPath && noteWasDirty) {
      next = withState(next, { dirty: true });
      next = requestNoteWrite(next, effects, false);
    }
  }

  return { state: next, effects };
}

// ── Small, shared moves ──────────────────────────────────────────────────

/** The one note-write request for the *open* editor. Refuses while a conflict
 *  is up (the user has not answered yet, so nothing may be retried behind their
 *  back) and defers with `deferredNote` while a write is flying — the payload
 *  is captured here, which is what lets the flush survive the dialog closing. */
function requestNoteWrite(
  state: PlanWriteState,
  effects: PlanWriteEffect[],
  notify: boolean,
): PlanWriteState {
  const target = state.target;
  if (target === null || !state.dirty) return state;
  if (state.conflict !== null) return state;
  if (isWriteBusy(state)) {
    return withState(state, {
      deferredNote: { path: target.path, note: state.draft, expectedMtime: target.mtime },
    });
  }
  return emitNoteWrite(state, effects, {
    path: target.path,
    note: state.draft,
    expectedMtime: target.mtime,
    notify,
  });
}

/** Put a note write on the wire. The payload is already decided, so the write
 *  does not depend on the editor still being open. */
function emitNoteWrite(
  state: PlanWriteState,
  effects: PlanWriteEffect[],
  write: { path: string; note: string; expectedMtime: string; notify: boolean },
): PlanWriteState {
  const planned = planWriteFor(
    { kind: "note", note: write.note, notify: write.notify },
    { path: write.path, expectedMtime: write.expectedMtime, force: false },
  );
  effects.push(planned.effect);
  let next = withState(state, {
    writeInFlight: planned.inFlight,
    // The current draft is going out now; a deferral for the same plan is
    // superseded by it.
    deferredNote:
      state.deferredNote !== null && state.deferredNote.path === write.path
        ? null
        : state.deferredNote,
  });
  // The status only tracks the plan that is actually open.
  if (next.target?.path === write.path) next = withState(next, { saveStatus: "saving" });
  return next;
}

/** What a write that just settled says about a note owed since before it. */
interface SettledWrite {
  /** The path that write started on. */
  path: string;
  kind: PlanWriteKind | null;
  /** The note a settled note write carried, so an identical deferral is not
   *  sent twice. */
  note: string | null;
  /** The plan it returned, when it succeeded; `null` when it failed. */
  plan: Plan | null;
}

/**
 * The deferred note write a settle owes, if any. A write that renamed the file
 * re-points the note at the new path and the new `mtime`; a write that failed
 * changed nothing, so the captured values still hold.
 */
function settleDeferred(
  state: PlanWriteState,
  effects: PlanWriteEffect[],
  settled: SettledWrite | null,
): PlanWriteState {
  const deferred = state.deferredNote;
  if (deferred === null) return state;
  // A write the reduction itself started (a 「覆盖」 that unblocked a flush) owns
  // the slot now; this deferral survives for the next settle.
  if (isWriteBusy(state)) return state;
  if (state.conflict !== null) return withState(state, { deferredNote: null });

  const settledThisPlan = settled !== null && settled.path === deferred.path;
  const nextPlan = settledThisPlan ? settled.plan : null;
  const path = nextPlan !== null ? nextPlan.path : deferred.path;
  const expectedMtime = nextPlan !== null ? nextPlan.mtime : deferred.expectedMtime;
  // A note write that carried exactly this note already put it on disk.
  const alreadyOnDisk =
    settledThisPlan && settled.kind === "note" && settled.note === deferred.note;

  const next = withState(state, { deferredNote: null });
  if (alreadyOnDisk) return next;
  return emitNoteWrite(next, effects, { path, note: deferred.note, expectedMtime, notify: false });
}

/** One of the four file writes, with the payload that write carries. */
type PlanWriteRequest =
  /** `notify` is Ctrl/Cmd+S: report this one when it lands. */
  | { kind: "note"; note: string; notify: boolean }
  | { kind: "done"; done: boolean }
  | { kind: "anchor"; anchor: PlanAnchor }
  | { kind: "rename"; title: string };

/** Where a write goes and how it is guarded. `expectedMtime: null` only ever
 *  travels with `force: true` — the user's 「覆盖」. */
interface PlanWriteGuard {
  path: string;
  expectedMtime: string | null;
  force: boolean;
}

/**
 * The single place "which write, with what payload" becomes "this effect, and
 * this latch". Every writer — a row control, a 「覆盖」, a conflict resolution —
 * comes through here, so the effect and the in-flight record it is paired with
 * cannot drift apart.
 */
function planWriteFor(
  request: PlanWriteRequest,
  guard: PlanWriteGuard,
): { effect: PlanWriteEffect; inFlight: PlanWriteInFlight } {
  const base = { path: guard.path, force: guard.force };
  switch (request.kind) {
    case "note":
      return {
        effect: {
          kind: "write_note",
          path: guard.path,
          note: request.note,
          expectedMtime: guard.expectedMtime,
          force: guard.force,
        },
        inFlight: { ...base, kind: "note", notify: request.notify, note: request.note },
      };
    case "done":
      return {
        effect: {
          kind: "write_done",
          path: guard.path,
          done: request.done,
          expectedMtime: guard.expectedMtime,
          force: guard.force,
        },
        inFlight: { ...base, kind: "done", notify: false, note: null },
      };
    case "anchor":
      return {
        effect: {
          kind: "write_anchor",
          path: guard.path,
          anchor: request.anchor,
          expectedMtime: guard.expectedMtime,
          force: guard.force,
        },
        inFlight: { ...base, kind: "anchor", notify: false, note: null },
      };
    case "rename":
      return {
        effect: {
          kind: "write_title",
          path: guard.path,
          title: request.title,
          expectedMtime: guard.expectedMtime,
          force: guard.force,
        },
        inFlight: { ...base, kind: "rename", notify: false, note: null },
      };
  }
}

/** The refused action as the write that redoes it. Only the note needs a
 *  payload the conflict cannot carry: the draft as it is right now (and it is
 *  never the Ctrl/Cmd+S kind — the overwrite reports itself through the
 *  notice). */
function retryRequest(retry: PlanConflictRetry, note: string): PlanWriteRequest {
  switch (retry.kind) {
    case "note":
      return { kind: "note", note, notify: false };
    case "done":
      return retry;
    case "anchor":
      return retry;
    case "rename":
      return retry;
  }
}

/** Run one request: latch the write and hand back what to perform. */
function started(
  state: PlanWriteState,
  request: PlanWriteRequest,
  guard: PlanWriteGuard,
): PlanWriteReduction {
  const write = planWriteFor(request, guard);
  return { state: startWrite(state, write.inFlight), effects: [write.effect] };
}

/** One write will now fly: this is the latch, and the whole point of the
 *  machine is that it is a single slot rather than three hand-copied flags. */
function startWrite(state: PlanWriteState, inFlight: PlanWriteInFlight): PlanWriteState {
  return withState(state, { writeInFlight: inFlight });
}

function clearWrite(state: PlanWriteState): PlanWriteState {
  return withState(state, { writeInFlight: null, creating: false });
}

function isWriteBusy(state: PlanWriteState): boolean {
  return state.writeInFlight !== null || state.creating;
}

/** Hand the editor a plan: its note becomes the draft and it opens clean. */
function openPlanInEditor(state: PlanWriteState, plan: Plan): PlanWriteState {
  return withState(state, {
    target: { path: plan.path, mtime: plan.mtime },
    draft: plan.note,
    dirty: false,
    saveStatus: "saved",
  });
}

function closeEditor(state: PlanWriteState): PlanWriteState {
  return withState(state, { target: null, draft: "", dirty: false, saveStatus: "saved" });
}

/** If the editor is open on `fromPath`, re-point it at the plan the server just
 *  returned. Every successful write ends here, which is what keeps the next
 *  guard from seeing a false conflict. */
function adoptEditor(state: PlanWriteState, fromPath: string, plan: Plan): PlanWriteState {
  const target = state.target;
  if (target?.path !== fromPath) return state;
  if (target.path === plan.path && target.mtime === plan.mtime) return state;
  return withState(state, { target: { path: plan.path, mtime: plan.mtime } });
}

function cancelAutosave(state: PlanWriteState, effects: PlanWriteEffect[]): PlanWriteState {
  if (!state.autosaveScheduled) return state;
  effects.push({ kind: "cancel_save" });
  return withState(state, { autosaveScheduled: false });
}

/** Patch, keeping the object identity when nothing actually moved (the panel
 *  re-renders off this state). */
function withState(state: PlanWriteState, patch: Partial<PlanWriteState>): PlanWriteState {
  for (const key of Object.keys(patch) as Array<keyof PlanWriteState>) {
    if (!Object.is(state[key], patch[key])) return { ...state, ...patch };
  }
  return state;
}

// ── The effect executor (the second seam) ────────────────────────────────

/** What a list read produced. `null` is "the read failed": for the silent read
 *  that is the panel's "the plan is not there" (its `reload` returns null and
 *  the resolution reads it as not found); for the visible one the panel only
 *  shows its own error, so no intent is reported. */
export type PlanListRead = readonly Plan[] | null;

/**
 * The dependencies the effect loop runs against. The hook wires the real ones
 * (`updatePlan` / `createPlan` / `fetchPlans` + `flattenPlanSections`, a
 * `setTimeout` pair, the toast); a test wires fakes with a controllable clock.
 * Nothing here is imported by the module, which is what makes the ordering
 * knowledge above drivable by fakes.
 */
export interface PlanWritePort {
  writeNote(input: {
    path: string;
    note: string;
    expectedMtime: string | null;
    force: boolean;
  }): Promise<Plan>;
  writeDone(input: {
    path: string;
    done: boolean;
    expectedMtime: string | null;
    force: boolean;
  }): Promise<Plan>;
  writeAnchor(input: {
    path: string;
    anchor: PlanAnchor;
    expectedMtime: string | null;
    force: boolean;
  }): Promise<Plan>;
  writeTitle(input: {
    path: string;
    title: string;
    expectedMtime: string | null;
    force: boolean;
  }): Promise<Plan>;
  createPlan(input: { title: string; anchor: PlanAnchor }): Promise<Plan>;
  /** Silent re-read (conflict resolution). */
  reloadList(): Promise<PlanListRead>;
  /** Re-read with the spinner (the panel's `load`). */
  refreshList(): Promise<PlanListRead>;
  scheduleSave(delayMs: number): void;
  cancelSave(): void;
  toast(toast: PlanToast): void;
}

/** How the loop feeds an outcome back: the caller reduces it (and, in the hook,
 *  runs the effects that reduction asks for). Awaiting the returned promise is
 *  what keeps one reduction's effects ordered ahead of the next one's. */
export type PlanWriteDispatch = (intent: PlanWriteIntent) => void | Promise<void>;

/**
 * Perform one reduction's effects, in order, feeding each outcome back through
 * `dispatch` — which is where the next reduction happens, so the loop lives
 * here and both the hook and the tests run this one.
 *
 * The classification of a failure stays here (not in the port): `planWriteFailure`
 * decides whether a rejection is a conflict the user must answer, a name that
 * is taken, or an error — and the retry payload is read off the effect that was
 * running, so `write_conflicted` can only ever carry the action that was
 * actually refused.
 */
export async function runPlanWriteEffects(
  effects: readonly PlanWriteEffect[],
  port: PlanWritePort,
  dispatch: PlanWriteDispatch,
): Promise<void> {
  for (const effect of effects) {
    switch (effect.kind) {
      case "write_note":
        await performWrite({ kind: "note" }, () => port.writeNote(effect), dispatch);
        break;
      case "write_done":
        await performWrite(
          { kind: "done", done: effect.done },
          () => port.writeDone(effect),
          dispatch,
        );
        break;
      case "write_anchor":
        await performWrite(
          { kind: "anchor", anchor: effect.anchor },
          () => port.writeAnchor(effect),
          dispatch,
        );
        break;
      case "write_title":
        await performWrite(
          { kind: "rename", title: effect.title },
          () => port.writeTitle(effect),
          dispatch,
        );
        break;
      case "write_create": {
        try {
          await dispatch({ type: "write_succeeded", plan: await port.createPlan(effect) });
        } catch (err) {
          // A create has no `mtime` to guard and no path to move, so a 409 that
          // reads as a conflict is just an error here.
          const failure = planWriteFailure(err);
          await dispatch({
            type: "write_failed",
            failure:
              failure.kind === "conflict" ? { kind: "error", message: failure.message } : failure,
          });
        }
        break;
      }
      case "reload_list": {
        const plans = await port.reloadList();
        // A failed silent read is "not found" — the panel's `reload` returns
        // null and the resolution reads that as "the plan is not there".
        await dispatch({ type: "list_refreshed", plans: plans ?? [], kind: "reload" });
        break;
      }
      case "refresh_list": {
        const plans = await port.refreshList();
        // A failed visible read is the panel's own error surface; it reports
        // nothing back, so an open dialog is not closed on a network blip.
        if (plans !== null) await dispatch({ type: "list_refreshed", plans, kind: "refresh" });
        break;
      }
      case "schedule_save":
        port.scheduleSave(effect.delayMs);
        break;
      case "cancel_save":
        port.cancelSave();
        break;
      case "toast":
        port.toast(effect.toast);
        break;
    }
  }
}

/** Run one of the four file writes and report how it ended. */
async function performWrite(
  retry: PlanConflictRetry,
  perform: () => Promise<Plan>,
  dispatch: PlanWriteDispatch,
): Promise<void> {
  try {
    await dispatch({ type: "write_succeeded", plan: await perform() });
  } catch (err) {
    const failure = planWriteFailure(err);
    if (failure.kind === "conflict") {
      await dispatch({
        type: "write_conflicted",
        code: failure.code,
        movedTo: failure.movedTo,
        retry,
        message: failure.message,
      });
      return;
    }
    await dispatch({ type: "write_failed", failure });
  }
}
