import { describe, expect, it } from "vitest";
import {
  PlanConflictError,
  createPlanWriteState,
  reducePlanWriteSession,
  runPlanWriteEffects,
  type PlanToast,
  type PlanWriteIntent,
  type PlanWritePort,
  type PlanWriteState,
} from "@/lib/client/plan-write-session";
import type { Plan, PlanAnchor } from "@/lib/shared/plans";

/**
 * The effect executor, driven by a scripted dependency bag (#78's second seam).
 *
 * The reducer tests prove *what should happen*; these prove the *order* of what
 * happens when the port is real-ish: a write that fails is classified into the
 * right intent, a settle feeds the next reduction, a deferred note reaches the
 * wire, and a failed list read does not close an open dialog. Same shape as
 * `tests/unit/turn-orchestrate.test.ts` driving `runTurn` with fake sessions.
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

/** One write that reached the port, as outward evidence of the sequence. */
interface WriteCall {
  kind: "note" | "done" | "anchor" | "title" | "create";
  path: string;
  mtime: string | null;
  force: boolean;
  note?: string;
  done?: boolean;
  title?: string;
}

/**
 * A scripted dependency bag: the port half of the executor. Writes answer with
 * the next scripted plan (or throw the scripted error); the debounce is
 * callable by hand, like the wiring's `setTimeout` callback.
 */
class Harness {
  state: PlanWriteState = createPlanWriteState();
  readonly writes: WriteCall[] = [];
  readonly toasts: PlanToast[] = [];
  /** The reads the port was asked for, in order. */
  readonly reads: string[] = [];
  /** What the next list read answers with; `null` = the read failed. */
  listRead: readonly Plan[] | null = [];
  /** The armed debounce, as the wiring holds it. */
  private autosave: (() => void) | null = null;
  private readonly answers: Array<Plan | Error>;
  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;

  constructor(answers: Array<Plan | Error> = []) {
    this.answers = [...answers];
  }

  /** Add answers for writes that have not been reached yet. */
  script(...answers: Array<Plan | Error>): void {
    this.answers.push(...answers);
  }

  /** Hold the next write in the air until `releaseWrite()` is called. */
  holdNextWrite(): void {
    this.gate = new Promise((resolve) => {
      this.openGate = resolve;
    });
  }

  releaseWrite(): void {
    const open = this.openGate;
    this.gate = null;
    this.openGate = null;
    open?.();
  }

  /** The wiring's `setTimeout` callback: it dispatches the debounce intent. */
  async fireAutosave(): Promise<void> {
    const fire = this.autosave;
    this.autosave = null;
    if (fire !== null) await this.dispatch({ type: "autosave_fired" });
  }

  readonly dispatch = async (intent: PlanWriteIntent): Promise<void> => {
    const reduction = reducePlanWriteSession(this.state, intent);
    this.state = reduction.state;
    await runPlanWriteEffects(reduction.effects, this.port, this.dispatch);
  };

  private async settle(call: WriteCall): Promise<Plan> {
    this.writes.push(call);
    const gate = this.gate;
    if (gate !== null) await gate;
    const answer = this.answers.shift();
    if (answer === undefined) throw new Error(`unscripted write: ${call.kind}`);
    if (answer instanceof Error) throw answer;
    return answer;
  }

  private readonly port: PlanWritePort = {
    writeNote: (input) =>
      this.settle({
        kind: "note",
        path: input.path,
        mtime: input.expectedMtime,
        force: input.force,
        note: input.note,
      }),
    writeDone: (input) =>
      this.settle({
        kind: "done",
        path: input.path,
        mtime: input.expectedMtime,
        force: input.force,
        done: input.done,
      }),
    writeAnchor: (input) => {
      const anchor: PlanAnchor = input.anchor;
      return this.settle({
        kind: "anchor",
        path: input.path,
        mtime: input.expectedMtime,
        force: input.force,
        title: anchor.kind === "inbox" ? "inbox" : anchor.kind === "month" ? anchor.month : anchor.date,
      });
    },
    writeTitle: (input) =>
      this.settle({
        kind: "title",
        path: input.path,
        mtime: input.expectedMtime,
        force: input.force,
        title: input.title,
      }),
    createPlan: (input) =>
      this.settle({ kind: "create", path: "", mtime: null, force: false, title: input.title }),
    reloadList: async () => {
      this.reads.push("reload");
      return this.listRead;
    },
    refreshList: async () => {
      this.reads.push("refresh");
      return this.listRead;
    },
    scheduleSave: (delayMs) => {
      this.reads.push(`schedule:${delayMs}`);
      // The wiring holds the timer; `fireAutosave` is its callback.
      this.autosave = () => undefined;
    },
    cancelSave: () => {
      this.reads.push("cancel");
      this.autosave = null;
    },
    toast: (toast) => {
      this.toasts.push(toast);
    },
  };
}

describe("plan write effects: the debounce is the module's, the timer is the port's", () => {
  it("arms 600ms, then writes the draft with the mtime the note was read at", async () => {
    const h = new Harness([plan({ note: "v1", mtime: "m2" })]);
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({ type: "note_edited", note: "v1" });
    expect(h.reads).toEqual(["schedule:600"]);

    await h.fireAutosave();
    expect(h.writes).toEqual([
      { kind: "note", path: PATH, mtime: "m1", force: false, note: "v1" },
    ]);
    expect(h.state).toMatchObject({ dirty: false, saveStatus: "saved" });
    expect(h.state.target).toEqual({ path: PATH, mtime: "m2" });
  });

  it("cancels the debounce when the dialog closes", async () => {
    const h = new Harness();
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({ type: "note_edited", note: "v1" });
    await h.dispatch({ type: "close_dialog" });
    expect(h.reads).toEqual(["schedule:600", "cancel"]);
  });
});

describe("plan write effects: a refusal is classified, not passed through", () => {
  it("turns a 409 into a pending conflict and stops writing", async () => {
    const h = new Harness([new PlanConflictError("modified", "changed on disk", null)]);
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({ type: "note_edited", note: "v1" });
    await h.fireAutosave();
    expect(h.writes).toHaveLength(1);
    expect(h.state.conflict).toEqual({
      path: PATH,
      code: "modified",
      movedTo: null,
      retry: { kind: "note" },
    });

    // The notice blocks the next debounce: the server is asked nothing more.
    await h.dispatch({ type: "note_edited", note: "v2" });
    await h.fireAutosave();
    expect(h.writes).toHaveLength(1);
  });

  it("turns anything else into a toast and an error status, keeping the draft", async () => {
    const h = new Harness([new Error("network down")]);
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({ type: "note_edited", note: "v1" });
    await h.fireAutosave();

    expect(h.toasts).toEqual([{ key: "save_failed", level: "error", description: "network down" }]);
    expect(h.state).toMatchObject({ draft: "v1", dirty: true, saveStatus: "error" });
  });

  it("redoes the action that was refused when the user answers 「覆盖」", async () => {
    const h = new Harness([new PlanConflictError("modified", "changed", null)]);
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({ type: "toggle_done", plan: plan() });
    expect(h.state.conflict?.retry).toEqual({ kind: "done", done: true });

    h.script(plan({ done: true, mtime: "m2" }));
    await h.dispatch({ type: "conflict_answered", choice: "overwrite" });
    expect(h.writes).toEqual([
      { kind: "done", path: PATH, mtime: "m1", force: false, done: true },
      { kind: "done", path: PATH, mtime: null, force: true, done: true },
    ]);
    expect(h.state.conflict).toBeNull();
  });

  it("follows the file on 「重载到新位置」 and re-applies what was refused", async () => {
    const h = new Harness([
      new PlanConflictError("missing", "The plan file is gone", MOVED),
    ]);
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({ type: "note_edited", note: "v1" });
    await h.fireAutosave();
    expect(h.state.conflict).toMatchObject({ code: "missing", movedTo: MOVED });

    h.script(plan({ path: MOVED, mtime: "m5" }));
    h.listRead = [plan({ path: MOVED, mtime: "m5" })];
    await h.dispatch({ type: "conflict_answered", choice: "reload" });

    expect(h.reads).toContain("reload");
    // The refused note followed the file to where it moved.
    expect(h.writes[1]).toEqual({
      kind: "note",
      path: MOVED,
      mtime: "m5",
      force: false,
      note: "v1",
    });
    expect(h.state.target).toEqual({ path: MOVED, mtime: "m5" });
  });

  it("keeps the notice up when the silent read fails (the plan is not there)", async () => {
    const h = new Harness([new PlanConflictError("missing", "gone", null)]);
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({ type: "note_edited", note: "v1" });
    await h.fireAutosave();

    h.listRead = null;
    await h.dispatch({ type: "conflict_answered", choice: "reload" });
    expect(h.toasts).toEqual([{ key: "plan_missing", level: "error" }]);
    expect(h.state.conflict).not.toBeNull();
  });
});

describe("plan write effects: nothing typed during a round trip is lost", () => {
  it("writes both drafts, in order, when the user keeps typing while a write flies", async () => {
    const h = new Harness([plan({ note: "v1", mtime: "m2" }), plan({ note: "v2", mtime: "m3" })]);
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({ type: "note_edited", note: "v1" });

    h.holdNextWrite();
    const flying = h.dispatch({ type: "autosave_fired" });
    // A keystroke lands while the round trip is in the air.
    await h.dispatch({ type: "note_edited", note: "v2" });
    h.releaseWrite();
    await flying;

    expect(h.writes.map((write) => write.note)).toEqual(["v1", "v2"]);
    // The second write carries the newer draft and the mtime the first one moved.
    expect(h.writes[1]).toMatchObject({ mtime: "m2", force: false });
    expect(h.state).toMatchObject({ dirty: false, saveStatus: "saved" });
    expect(h.state.target).toEqual({ path: PATH, mtime: "m3" });
  });

  it("closes the dialog and still writes the keystroke made mid-flight, exactly once", async () => {
    const h = new Harness([plan({ note: "v1", mtime: "m2" }), plan({ note: "v2", mtime: "m3" })]);
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({ type: "note_edited", note: "v1" });

    h.holdNextWrite();
    const flying = h.dispatch({ type: "autosave_fired" });
    await h.dispatch({ type: "note_edited", note: "v2" });
    await h.dispatch({ type: "close_dialog" });
    expect(h.state.target).toBeNull();

    h.releaseWrite();
    await flying;

    expect(h.writes.map((write) => write.note)).toEqual(["v1", "v2"]);
    expect(h.writes).toHaveLength(2);
    expect(h.state.target).toBeNull();
  });
});

describe("plan write effects: the list is read, and a failed read is not an empty list", () => {
  it("re-reads the list with the spinner after a move", async () => {
    const h = new Harness([plan({ path: MOVED, mtime: "m2" })]);
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({
      type: "reschedule",
      plan: plan(),
      choice: "tomorrow",
      today: "2026-09-19",
    });
    expect(h.writes).toEqual([
      { kind: "anchor", path: PATH, mtime: "m1", force: false, title: "2026-09-20" },
    ]);
    expect(h.reads).toEqual(["reload"]);
  });

  it("re-reads it with the spinner after a create, and does not close anything when that fails", async () => {
    const h = new Harness([plan({ path: MOVED, mtime: "m9" })]);
    // The read that follows the create still lists the plan the dialog is on.
    h.listRead = [plan({ mtime: "m1" })];
    await h.dispatch({ type: "open_plan", plan: plan() });
    await h.dispatch({ type: "create_submitted", title: "新的一条", anchor: { kind: "inbox" } });
    expect(h.writes).toEqual([
      { kind: "create", path: "", mtime: null, force: false, title: "新的一条" },
    ]);
    expect(h.reads).toEqual(["refresh"]);
    expect(h.state.creating).toBe(false);
    expect(h.state.target).toEqual({ path: PATH, mtime: "m1" });
  });

  it("leaves the dialog open when the visible read fails", async () => {
    const h = new Harness([plan({ path: MOVED, mtime: "m9" })]);
    await h.dispatch({ type: "open_plan", plan: plan() });
    h.listRead = null;
    await h.dispatch({ type: "create_submitted", title: "新的一条", anchor: { kind: "inbox" } });
    expect(h.toasts).toEqual([]);
    expect(h.state.target).toEqual({ path: PATH, mtime: "m1" });
  });

  it("closes the dialog and says so when this read no longer lists the plan", async () => {
    const h = new Harness();
    await h.dispatch({ type: "open_plan", plan: plan() });
    // A visible read is also what `load()` hands the machine: the plan is gone
    // from it, so the dialog closes rather than letting the user type into a
    // file that is not there.
    await h.dispatch({ type: "list_refreshed", plans: [], kind: "refresh" });
    expect(h.toasts).toEqual([{ key: "plan_missing", level: "error" }]);
    expect(h.state.target).toBeNull();
  });
});
