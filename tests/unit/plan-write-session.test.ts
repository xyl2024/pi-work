import { describe, expect, it } from "vitest";
import {
  PLAN_AUTOSAVE_MS,
  PLAN_WRITE_EFFECT_KINDS,
  PLAN_WRITE_INTENT_TYPES,
  createPlanWriteState,
  planConflictSurface,
  reducePlanWriteSession,
  type PlanWriteEffect,
  type PlanWriteIntent,
  type PlanWriteState,
} from "@/lib/client/plan-write-session";
import type { Plan } from "@/lib/shared/plans";

/**
 * The plan write session, driven by intents only (#78's slice 1/2).
 *
 * These tests feed an intent sequence and assert the *new situation* and the
 * *effects to perform* — never a private field, a timer, a React render or a
 * request. They are the executable form of the rules the panel used to keep in
 * the reader's head: one write flies at a time, a note typed during a round
 * trip is not lost, a 409 suspends writes until the user answers, and a
 * successful write always moves the `mtime` the next write guards on.
 */

const PATH = "2026-09/2026-09-19-写点东西.md";
const MOVED = "2026-10/2026-10-02-写点东西.md";

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    path: PATH,
    absPath: `/data/user-plans/${PATH}`,
    title: "写点东西",
    anchor: { kind: "day", date: "2026-09-19" },
    done: false,
    createdAt: null,
    doneAt: null,
    note: "",
    mtime: "m1",
    ...overrides,
  };
}

function step(state: PlanWriteState, intent: PlanWriteIntent) {
  return reducePlanWriteSession(state, intent);
}

function kinds(effects: readonly PlanWriteEffect[]): string[] {
  return effects.map((effect) => effect.kind);
}

/** The dialog open on `target`, which is the state every note test starts from. */
function opened(target = plan()): PlanWriteState {
  return step(createPlanWriteState(), { type: "open_plan", plan: target }).state;
}

/** Type a note and let the debounce fire: the state a write is flying in. */
function wrote(state: PlanWriteState, note: string) {
  return step(step(state, { type: "note_edited", note }).state, { type: "autosave_fired" });
}

describe("plan write session: the note and its debounce", () => {
  it("arms the debounce on every keystroke and writes when it fires", () => {
    const typed = step(opened(), { type: "note_edited", note: "hello" });
    expect(typed.effects).toEqual([{ kind: "schedule_save", delayMs: PLAN_AUTOSAVE_MS }]);
    expect(typed.state).toMatchObject({
      draft: "hello",
      dirty: true,
      saveStatus: "unsaved",
      autosaveScheduled: true,
    });

    const fired = step(typed.state, { type: "autosave_fired" });
    expect(fired.effects).toEqual([
      { kind: "write_note", path: PATH, note: "hello", expectedMtime: "m1", force: false },
    ]);
    expect(fired.state.autosaveScheduled).toBe(false);
    expect(fired.state.writeInFlight).toMatchObject({ kind: "note", path: PATH });
    expect(fired.state.saveStatus).toBe("saving");
  });

  it("comes back clean and moves the mtime forward when the write lands", () => {
    const wrote1 = wrote(opened(), "hello");
    const landed = step(wrote1.state, {
      type: "write_succeeded",
      plan: plan({ note: "hello", mtime: "m2" }),
    });

    expect(landed.state).toMatchObject({ dirty: false, saveStatus: "saved", writeInFlight: null });
    expect(landed.state.target).toEqual({ path: PATH, mtime: "m2" });
    expect(landed.effects).toEqual([]);
  });

  it("keeps writing after Ctrl/Cmd+S, telling the panel to say so", () => {
    const state = opened();
    const typed = step(state, { type: "note_edited", note: "hello" });
    const saved = step(typed.state, { type: "save_now" });
    expect(saved.effects).toEqual([
      { kind: "cancel_save" },
      { kind: "write_note", path: PATH, note: "hello", expectedMtime: "m1", force: false },
    ]);

    const landed = step(saved.state, {
      type: "write_succeeded",
      plan: plan({ note: "hello", mtime: "m2" }),
    });
    expect(landed.effects).toEqual([{ kind: "toast", toast: { key: "plan_saved", level: "success" } }]);
  });

  it("does not send the note twice when Ctrl/Cmd+S is pressed after the debounce fired", () => {
    const saved = wrote(opened(), "hello");
    const again = step(saved.state, { type: "save_now" });
    expect(again.effects).toEqual([]);
  });
  it("keeps the draft and reports the failure when a plain save fails", () => {
    const saved = wrote(opened(), "hello");
    const failed = step(saved.state, {
      type: "write_failed",
      failure: { kind: "error", message: "network down" },
    });

    expect(failed.state).toMatchObject({
      draft: "hello",
      dirty: true,
      saveStatus: "error",
      writeInFlight: null,
    });
    expect(failed.effects).toEqual([
      { kind: "toast", toast: { key: "save_failed", level: "error", description: "network down" } },
    ]);
  });
});

describe("plan write session: nothing typed during a round trip is lost", () => {
  it("sends the newer draft when the round trip settles, and only then is the note clean", () => {
    const first = wrote(opened(), "v1");
    // Two more keystrokes while the write is in the air: the debounce fires
    // again, and the still-flying write defers the newer draft.
    const typed = step(first.state, { type: "note_edited", note: "v2" });    expect(typed.state.deferredNote).toEqual({ path: PATH, note: "v2", expectedMtime: "m1" });
    const fired = step(typed.state, { type: "autosave_fired" });
    expect(kinds(fired.effects)).toEqual([]);
    expect(fired.state.deferredNote).toEqual({ path: PATH, note: "v2", expectedMtime: "m1" });

    // The first write lands — the file has v1, the editor has v2.
    const landed = step(fired.state, {
      type: "write_succeeded",
      plan: plan({ note: "v1", mtime: "m2" }),
    });
    expect(landed.state.dirty).toBe(true);
    expect(landed.state.target).toEqual({ path: PATH, mtime: "m2" });
    expect(landed.effects).toEqual([
      { kind: "write_note", path: PATH, note: "v2", expectedMtime: "m2", force: false },
    ]);

    // Only the write that carried the newest draft marks the editor clean.
    const settled = step(landed.state, {
      type: "write_succeeded",
      plan: plan({ note: "v2", mtime: "m3" }),
    });
    expect(settled.state).toMatchObject({ dirty: false, saveStatus: "saved" });
    expect(settled.state.target).toEqual({ path: PATH, mtime: "m3" });
    expect(settled.effects).toEqual([]);
  });

  it("closes the dialog but still writes the keystroke made mid-flight — once", () => {
    const first = wrote(opened(), "v1");
    const typed = step(first.state, { type: "note_edited", note: "v2" });
    const closed = step(typed.state, { type: "close_dialog" });

    // Nothing to write yet, and only the debounce is cancelled.
    expect(closed.effects).toEqual([{ kind: "cancel_save" }]);
    expect(closed.state.target).toBeNull();
    expect(closed.state.draft).toBe("");
    expect(closed.state.dirty).toBe(false);

    const landed = step(closed.state, {
      type: "write_succeeded",
      plan: plan({ note: "v1", mtime: "m2" }),
    });
    expect(landed.effects).toEqual([
      { kind: "write_note", path: PATH, note: "v2", expectedMtime: "m2", force: false },
    ]);
    // One write, not two: the payload is the one the user typed.
    expect(landed.state.writeInFlight).toMatchObject({ note: "v2" });
  });

  it("switching plans flushes the plan being left and leaves the new one alone", () => {
    const other = "2026-09/2026-09-19-另一条.md";
    const first = wrote(opened(), "v1");
    const typed = step(first.state, { type: "note_edited", note: "v2" });
    const switched = step(typed.state, { type: "open_plan", plan: plan({ path: other, note: "other" }) });

    expect(kinds(switched.effects)).toEqual(["cancel_save"]);
    expect(switched.state.target).toEqual({ path: other, mtime: "m1" });
    expect(switched.state.draft).toBe("other");
    expect(switched.state.dirty).toBe(false);

    const landed = step(switched.state, {
      type: "write_succeeded",
      plan: plan({ note: "v1", mtime: "m2" }),
    });
    // The note is written to the plan it was typed against, not the new one.
    expect(landed.effects).toEqual([
      { kind: "write_note", path: PATH, note: "v2", expectedMtime: "m2", force: false },
    ]);
    expect(landed.state.target).toEqual({ path: other, mtime: "m1" });
    expect(landed.state.saveStatus).toBe("saved");
  });

  it("re-points the deferred note at the new path when the flying write moved the file", () => {
    const renameInFlight = step(opened(), { type: "rename", plan: plan(), title: "新名字" });
    const typed = step(
      step(renameInFlight.state, { type: "note_edited", note: "v2" }).state,
      { type: "close_dialog" },
    );
    const landed = step(typed.state, {
      type: "write_succeeded",
      plan: plan({ path: MOVED, title: "新名字", mtime: "m2" }),
    });
    expect(landed.effects).toEqual([
      { kind: "reload_list" },
      { kind: "write_note", path: MOVED, note: "v2", expectedMtime: "m2", force: false },
    ]);
  });
});

describe("plan write session: conflicts", () => {
  it("suspends on a 409 and does not retry until the user answers", () => {
    const conflicted = step(wrote(opened(), "hello").state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "note" },
      message: "changed on disk",
    });
    expect(conflicted.state.conflict).toEqual({
      path: PATH,
      code: "modified",
      movedTo: null,
      retry: { kind: "note" },
    });
    expect(conflicted.state).toMatchObject({ saveStatus: "unsaved", writeInFlight: null });
    expect(conflicted.effects).toEqual([]);

    // A debounce that races the notice writes nothing, and is not deferred.
    const typed = step(conflicted.state, { type: "note_edited", note: "more" });
    const fired = step(typed.state, { type: "autosave_fired" });
    expect(fired.effects).toEqual([]);
    expect(fired.state.deferredNote).toBeNull();
    expect(fired.state.conflict).not.toBeNull();
  });

  it("「覆盖」 redoes the refused note with force and closes the notice", () => {
    const conflicted = step(wrote(opened(), "hello").state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "note" },
      message: "changed on disk",
    });
    const overwrite = step(conflicted.state, { type: "conflict_answered", choice: "overwrite" });
    expect(overwrite.effects).toEqual([
      { kind: "write_note", path: PATH, note: "hello", expectedMtime: null, force: true },
    ]);

    const landed = step(overwrite.state, {
      type: "write_succeeded",
      plan: plan({ note: "hello", mtime: "m3" }),
    });
    expect(landed.state.conflict).toBeNull();
    expect(landed.state).toMatchObject({ dirty: false, saveStatus: "saved" });
    expect(landed.state.target).toEqual({ path: PATH, mtime: "m3" });
  });

  it("「重载到新位置」 replaces the draft with what is on disk", () => {
    const conflicted = step(wrote(opened(), "hello").state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "note" },
      message: "changed on disk",
    });
    const answer = step(conflicted.state, { type: "conflict_answered", choice: "reload" });
    expect(answer.effects).toEqual([{ kind: "reload_list" }]);

    const resolved = step(answer.state, {
      type: "list_refreshed",
      plans: [plan({ note: "disk wins", mtime: "m9" })],
      kind: "reload",
    });
    expect(resolved.state.conflict).toBeNull();
    expect(resolved.state).toMatchObject({ draft: "disk wins", dirty: false, saveStatus: "saved" });
    expect(resolved.state.target).toEqual({ path: PATH, mtime: "m9" });
    expect(resolved.effects).toEqual([]);
  });

  it("writes a dirty note to the new path when the file was moved away", () => {
    const typed = step(opened(), { type: "note_edited", note: "typed" }).state;
    const conflicted = step(wrote(typed, "typed").state, {
      type: "write_conflicted",
      code: "missing",
      movedTo: MOVED,
      retry: { kind: "note" },
      message: "The plan file is gone",
    });
    expect(conflicted.state.dirty).toBe(true);

    const answer = step(conflicted.state, { type: "conflict_answered", choice: "reload" });
    const resolved = step(answer.state, {
      type: "list_refreshed",
      plans: [plan({ path: MOVED, mtime: "m5" })],
      kind: "reload",
    });

    expect(resolved.effects).toEqual([
      { kind: "write_note", path: MOVED, note: "typed", expectedMtime: "m5", force: false },
    ]);
    expect(resolved.state.target).toEqual({ path: MOVED, mtime: "m5" });
    expect(resolved.state.dirty).toBe(true);
  });

  it("keeps the notice up when the plan is gone for good", () => {
    const conflicted = step(wrote(opened(), "hello").state, {
      type: "write_conflicted",
      code: "missing",
      movedTo: null,
      retry: { kind: "note" },
      message: "gone",
    });
    const answer = step(conflicted.state, { type: "conflict_answered", choice: "reload" });
    const resolved = step(answer.state, { type: "list_refreshed", plans: [], kind: "reload" });

    expect(resolved.state.conflict).not.toBeNull();
    expect(resolved.effects).toEqual([{ kind: "toast", toast: { key: "plan_missing", level: "error" } }]);
  });

  it("keeps a refused completion on the row and a refused note in the dialog", () => {
    const done = step(opened(), { type: "toggle_done", plan: plan() });
    const doneConflict = step(done.state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "done", done: true },
      message: "changed",
    });
    expect(planConflictSurface(doneConflict.state.conflict!.retry)).toBe("row");

    const note = step(wrote(opened(), "hello").state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "note" },
      message: "changed",
    });
    expect(planConflictSurface(note.state.conflict!.retry)).toBe("dialog");
  });

  it("「覆盖」 redoes a re-schedule as a re-schedule, not as a note save", () => {
    const rescheduled = step(opened(), {
      type: "reschedule",
      plan: plan(),
      choice: "tomorrow",
      today: "2026-09-19",
    });
    expect(rescheduled.effects).toEqual([
      {
        kind: "write_anchor",
        path: PATH,
        anchor: { kind: "day", date: "2026-09-20" },
        expectedMtime: "m1",
        force: false,
      },
    ]);

    const conflicted = step(rescheduled.state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "anchor", anchor: { kind: "day", date: "2026-09-20" } },
      message: "changed",
    });
    const overwrite = step(conflicted.state, { type: "conflict_answered", choice: "overwrite" });
    expect(overwrite.effects).toEqual([
      {
        kind: "write_anchor",
        path: PATH,
        anchor: { kind: "day", date: "2026-09-20" },
        expectedMtime: null,
        force: true,
      },
    ]);
  });

  it("「覆盖」 redoes a rename as a rename", () => {
    const renamed = step(opened(), { type: "rename", plan: plan(), title: "新名字" });
    const conflicted = step(renamed.state, {
      type: "write_conflicted",
      code: "missing",
      movedTo: null,
      retry: { kind: "rename", title: "新名字" },
      message: "gone",
    });
    const overwrite = step(conflicted.state, { type: "conflict_answered", choice: "overwrite" });
    expect(overwrite.effects).toEqual([
      { kind: "write_title", path: PATH, title: "新名字", expectedMtime: null, force: true },
    ]);
  });

  it("holds at most one conflict: a newer one replaces the older", () => {
    const first = step(opened(), { type: "toggle_done", plan: plan() });
    const one = step(first.state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "done", done: true },
      message: "changed",
    }).state;
    const second = step(one, {
      type: "reschedule",
      plan: plan(),
      choice: "tomorrow",
      today: "2026-09-19",
    });
    const two = step(second.state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "anchor", anchor: { kind: "day", date: "2026-09-20" } },
      message: "changed",
    });
    expect(two.state.conflict).toEqual({
      path: PATH,
      code: "modified",
      movedTo: null,
      retry: { kind: "anchor", anchor: { kind: "day", date: "2026-09-20" } },
    });
  });

  it("dismissing the notice leaves the draft marked unsaved", () => {
    const conflicted = step(wrote(opened(), "hello").state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "note" },
      message: "changed",
    });
    const dismissed = step(conflicted.state, { type: "conflict_dismissed" });
    expect(dismissed.state.conflict).toBeNull();
    expect(dismissed.state.saveStatus).toBe("unsaved");
    expect(dismissed.effects).toEqual([]);
  });
});

describe("plan write session: one write flies at a time", () => {
  it("does not send a second note write while one is in the air", () => {
    const first = wrote(opened(), "v1");
    const second = step(first.state, { type: "autosave_fired" });
    expect(kinds(second.effects)).toEqual([]);
  });

  it("does not send a second completion toggle", () => {
    const first = step(opened(), { type: "toggle_done", plan: plan() });
    expect(kinds(first.effects)).toEqual(["write_done"]);
    const second = step(first.state, { type: "toggle_done", plan: plan() });
    expect(second.effects).toEqual([]);
  });

  it("does not move the same plan twice", () => {
    const first = step(opened(), {
      type: "reschedule",
      plan: plan(),
      choice: "tomorrow",
      today: "2026-09-19",
    });
    const second = step(first.state, {
      type: "reschedule",
      plan: plan(),
      choice: "week",
      today: "2026-09-19",
    });
    expect(second.effects).toEqual([]);
  });

  it("does not rename twice", () => {
    const first = step(opened(), { type: "rename", plan: plan(), title: "新名字" });
    const second = step(first.state, { type: "rename", plan: plan(), title: "另一个" });
    expect(second.effects).toEqual([]);
  });

  it("does not create a second plan for the double Enter", () => {
    const anchor = { kind: "day", date: "2026-09-19" } as const;
    const first = step(createPlanWriteState(), { type: "create_submitted", title: "新的一条", anchor });
    expect(first.state.creating).toBe(true);
    expect(kinds(first.effects)).toEqual(["write_create"]);

    const second = step(first.state, { type: "create_submitted", title: "新的一条", anchor });
    expect(second.effects).toEqual([]);
  });

  it("holds the row's writes while a note write is in the air", () => {
    const flying = wrote(opened(), "v1");
    expect(step(flying.state, { type: "toggle_done", plan: plan() }).effects).toEqual([]);
    expect(
      step(flying.state, { type: "reschedule", plan: plan(), choice: "tomorrow", today: "2026-09-19" })
        .effects,
    ).toEqual([]);
    expect(step(flying.state, { type: "rename", plan: plan(), title: "新名字" }).effects).toEqual([]);
    expect(
      step(flying.state, { type: "create_submitted", title: "新的一条", anchor: { kind: "inbox" } })
        .effects,
    ).toEqual([]);
  });
});

describe("plan write session: no-ops and names that are taken", () => {
  it("does not write when a re-schedule lands on the anchor the plan already has", () => {
    const today = "2026-09-19";
    const result = step(createPlanWriteState(), {
      type: "reschedule",
      plan: plan(),
      choice: "today",
      today,
    });
    expect(result.effects).toEqual([]);
    expect(result.state.writeInFlight).toBeNull();
  });

  it("reports a taken name for a create without ever offering 「覆盖」", () => {
    const submitted = step(createPlanWriteState(), {
      type: "create_submitted",
      title: "新的一条",
      anchor: { kind: "inbox" },
    });
    const failed = step(submitted.state, {
      type: "write_failed",
      failure: {
        kind: "name-taken",
        target: "2026-09/2026-09-19-新的一条.md",
        message: "A plan with that name already exists",
      },
    });
    expect(failed.state.creating).toBe(false);
    expect(failed.state.conflict).toBeNull();
    expect(failed.effects).toEqual([
      {
        kind: "toast",
        toast: {
          key: "create_failed",
          level: "error",
          description: "A plan with that name already exists",
        },
      },
    ]);
  });

  it("keeps a taken name off the overwrite path for a re-schedule too", () => {
    const rescheduled = step(opened(), {
      type: "reschedule",
      plan: plan(),
      choice: "month",
      today: "2026-09-19",
    });
    const failed = step(rescheduled.state, {
      type: "write_failed",
      failure: { kind: "name-taken", target: "2026-09/2026-09-01-x.md", message: "taken" },
    });
    expect(failed.state.conflict).toBeNull();
    expect(failed.effects).toEqual([
      { kind: "toast", toast: { key: "name_taken", level: "error", description: "2026-09/2026-09-01-x.md" } },
    ]);
  });
});

describe("plan write session: the list moves under the dialog", () => {
  it("closes the dialog and says so when the plan vanished from a visible read", () => {
    const state = opened();
    const refreshed = step(state, { type: "list_refreshed", plans: [], kind: "refresh" });
    expect(refreshed.state.target).toBeNull();
    expect(refreshed.state.draft).toBe("");
    expect(refreshed.effects).toEqual([{ kind: "toast", toast: { key: "plan_missing", level: "error" } }]);
  });

  it("leaves the dialog alone while the plan is still listed", () => {
    const state = opened();
    const refreshed = step(state, {
      type: "list_refreshed",
      plans: [plan({ mtime: "m2" })],
      kind: "refresh",
    });
    expect(refreshed.state.target).toEqual({ path: PATH, mtime: "m1" });
    expect(refreshed.effects).toEqual([]);
  });

  it("drops the editor and the notice of a deleted plan, then re-reads", () => {
    const conflicted = step(wrote(opened(), "hello").state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "note" },
      message: "changed",
    });
    const removed = step(conflicted.state, { type: "plan_removed", path: PATH });
    expect(removed.state).toMatchObject({ target: null, draft: "", conflict: null });
    expect(removed.effects).toEqual([{ kind: "refresh_list" }]);
  });

  it("does not touch another plan's editor when a different one is deleted", () => {
    const state = opened();
    const removed = step(state, { type: "plan_removed", path: MOVED });
    expect(removed.state.target).toEqual({ path: PATH, mtime: "m1" });
    expect(removed.effects).toEqual([{ kind: "refresh_list" }]);
  });
});

describe("plan write session: reading a plan into the dialog", () => {
  it("is a no-op when the plan is already open", () => {
    const state = opened();
    const again = step(state, { type: "open_plan", plan: plan({ note: "别的" }) });
    expect(again.state).toBe(state);
    expect(again.effects).toEqual([]);
  });

  it("flushes the dirty note left behind before showing the new one", () => {
    const typed = step(opened(), { type: "note_edited", note: "unsaved" });
    const switched = step(typed.state, {
      type: "open_plan",
      plan: plan({ path: MOVED, note: "别的" }),
    });
    expect(switched.effects).toEqual([
      { kind: "cancel_save" },
      { kind: "write_note", path: PATH, note: "unsaved", expectedMtime: "m1", force: false },
    ]);
    expect(switched.state.target).toEqual({ path: MOVED, mtime: "m1" });
    expect(switched.state.deferredNote).toBeNull();
  });
});

describe("plan write session: the protocol is closed", () => {
  const intents: PlanWriteIntent[] = [
    { type: "open_plan", plan: plan() },
    { type: "close_dialog" },
    { type: "note_edited", note: "x" },
    { type: "save_now" },
    { type: "autosave_fired" },
    { type: "toggle_done", plan: plan() },
    { type: "reschedule", plan: plan(), choice: "tomorrow", today: "2026-09-19" },
    { type: "rename", plan: plan(), title: "新名字" },
    { type: "create_submitted", title: "新的一条", anchor: { kind: "inbox" } },
    { type: "plan_removed", path: PATH },
    { type: "list_refreshed", plans: [], kind: "refresh" },
    { type: "write_succeeded", plan: plan() },
    { type: "write_conflicted", code: "modified", movedTo: null, retry: { kind: "note" }, message: "x" },
    { type: "write_failed", failure: { kind: "error", message: "x" } },
    { type: "conflict_answered", choice: "reload" },
    { type: "conflict_dismissed" },
  ];

  it("answers every intent without a default branch", () => {
    for (const intent of intents) {
      expect(() => reducePlanWriteSession(createPlanWriteState(), intent)).not.toThrow();
    }
  });

  it("exercises every intent the protocol declares", () => {
    // The runtime list is what the compile-time completeness assertion is
    // checked against; feeding exactly it keeps the two honest.
    expect(new Set(intents.map((intent) => intent.type))).toEqual(
      new Set(PLAN_WRITE_INTENT_TYPES),
    );
  });

  it("can ask for every effect the protocol declares", () => {
    const seen = new Set<string>();
    let state = createPlanWriteState();
    const ask = (intent: PlanWriteIntent) => {
      const reduction = reducePlanWriteSession(state, intent);
      state = reduction.state;
      for (const effect of reduction.effects) seen.add(effect.kind);
    };

    // A journey that touches all five writes, both reads, the debounce, the
    // notice and a toast: if a declared effect is unreachable, this fails.
    ask({ type: "open_plan", plan: plan() });
    ask({ type: "note_edited", note: "v1" });
    ask({ type: "autosave_fired" });
    ask({ type: "write_succeeded", plan: plan({ note: "v1", mtime: "m2" }) });
    ask({ type: "toggle_done", plan: plan({ mtime: "m2" }) });
    ask({ type: "write_succeeded", plan: plan({ done: true, mtime: "m3" }) });
    ask({ type: "reschedule", plan: plan({ mtime: "m3" }), choice: "tomorrow", today: "2026-09-19" });
    ask({ type: "write_succeeded", plan: plan({ path: MOVED, mtime: "m4" }) });
    ask({ type: "rename", plan: plan({ path: MOVED, mtime: "m4" }), title: "新名字" });
    ask({ type: "write_succeeded", plan: plan({ path: MOVED, title: "新名字", mtime: "m5" }) });
    ask({ type: "create_submitted", title: "新的一条", anchor: { kind: "inbox" } });
    ask({ type: "write_succeeded", plan: plan({ path: "inbox/新的一条.md" }) });
    ask({ type: "note_edited", note: "v2" });
    ask({ type: "save_now" });
    ask({ type: "write_failed", failure: { kind: "error", message: "boom" } });
    ask({ type: "plan_removed", path: MOVED });
    ask({ type: "note_edited", note: "v3" });
    ask({ type: "close_dialog" });

    expect([...seen].sort()).toEqual([...PLAN_WRITE_EFFECT_KINDS].sort());
  });
});

describe("plan write session: a notice belongs to the dialog that raised it", () => {
  it("clears the notice when another plan is opened", () => {
    const conflicted = step(wrote(opened(), "v1").state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "note" },
      message: "changed",
    });
    // The flush of the plan being left is attempted first — and a conflict
    // blocks it, exactly as the panel orders those two steps.
    const switched = step(conflicted.state, {
      type: "open_plan",
      plan: plan({ path: MOVED, note: "别的" }),
    });
    expect(switched.effects).toEqual([]);
    expect(switched.state.conflict).toBeNull();
    expect(switched.state.target).toEqual({ path: MOVED, mtime: "m1" });
  });

  it("clears it when a move for the same plan lands", () => {
    const conflicted = step(opened(), { type: "toggle_done", plan: plan() });
    const one = step(conflicted.state, {
      type: "write_conflicted",
      code: "modified",
      movedTo: null,
      retry: { kind: "note" },
      message: "changed",
    }).state;
    const moved = step(one, { type: "reschedule", plan: plan(), choice: "tomorrow", today: "2026-09-19" });
    const landed = step(moved.state, {
      type: "write_succeeded",
      plan: plan({ path: MOVED, mtime: "m2" }),
    });
    expect(landed.state.conflict).toBeNull();
  });
});

describe("plan write session: a deleted plan takes its pending work with it", () => {
  it("drops the editor, the notice and the note owed for it, and re-reads", () => {
    const first = wrote(opened(), "v1");
    const typed = step(first.state, { type: "note_edited", note: "v2" });
    const removed = step(typed.state, { type: "plan_removed", path: PATH });

    expect(removed.state).toMatchObject({
      target: null,
      draft: "",
      dirty: false,
      conflict: null,
      deferredNote: null,
    });
    expect(removed.effects).toEqual([{ kind: "cancel_save" }, { kind: "refresh_list" }]);

    // The write that was in the air settles into nothing: no second write for
    // a file that no longer exists, and nothing to come clean about.
    const landed = step(removed.state, {
      type: "write_succeeded",
      plan: plan({ note: "v1", mtime: "m2" }),
    });
    expect(landed.effects).toEqual([]);
    expect(landed.state.target).toBeNull();
  });
});
