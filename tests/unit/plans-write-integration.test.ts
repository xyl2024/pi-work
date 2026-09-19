import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { ISOLATED_DATA_DIR, TEST_BASE_URL } from "../config";
import { getAuthCookie, uniqueId } from "./helpers";
import { createPlan, fetchPlans, updatePlan } from "@/lib/client/plans";
import {
  createPlanWriteState,
  reducePlanWriteSession,
  runPlanWriteEffects,
  type PlanToast,
  type PlanWriteIntent,
  type PlanWritePort,
  type PlanWriteState,
} from "@/lib/client/plan-write-session";
import { flattenPlanSections, type Plan, type PlanAnchor } from "@/lib/shared/plans";

/**
 * The write session's second seam, driven against the *real* dependencies: the
 * isolated instance's HTTP through the production client
 * (`lib/client/plans`), the real `user-plans/` directory, and a clock the test
 * fires by hand (#79).
 *
 * The fake-port tests next door prove the *order* of what happens; these prove
 * what the *disk* says afterwards — the one thing a fake dependency bag cannot
 * answer. Saving mid-flight must leave the last draft in the file, answering
 * 「覆盖」 must really overwrite, a moved plan must take the dirty note to its new
 * path, a re-schedule must move bytes rather than rewrite them.
 *
 * The executor is the same `runPlanWriteEffects`; only the dependency bag is
 * real. Assertions stick to observables — file bytes, the returned plan, the
 * error's classification, which toast was picked — never to how many times a
 * port method was called, except where "only one write went out" *is* the rule
 * (a 409 must not be retried behind the user's back).
 *
 * Isolation: same rules as `plans-api.test.ts` — everything lives under the
 * isolated data root and is removed again; the real `~/.pi-work` is never
 * touched. The fetch shim below exists only because the production client
 * speaks relative URLs, which Node's `fetch` cannot resolve; it is an adapter,
 * not a stub — the requests really go to the isolated instance.
 */
const expandTilde = (p: string) => (p.startsWith("~") ? `${os.homedir()}${p.slice(1)}` : p);
const PLANS_ROOT = path.join(expandTilde(ISOLATED_DATA_DIR), "user-plans");

/** Fixed local day; the client sends its own key and the server never guesses. */
const TODAY = "2026-03-15";
const TODAY_ANCHOR: PlanAnchor = { kind: "day", date: TODAY };

function planAbs(rel: string): string {
  return path.join(PLANS_ROOT, rel);
}

function readPlan(rel: string): string {
  return readFileSync(planAbs(rel), "utf8");
}

/** Remove the files a test created; the isolated root is shared. */
function removePlanFiles(paths: readonly string[]): void {
  for (const rel of paths) rmSync(planAbs(rel), { force: true });
}

const realFetch = globalThis.fetch.bind(globalThis);

beforeAll(async () => {
  const cookie = `pi-work-auth=${await getAuthCookie()}`;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" && input.startsWith("/") ? `${TEST_BASE_URL}${input}` : input;
    return realFetch(url, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), cookie },
    });
  };
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

/** The plan as the server lists it now — what the session should have adopted. */
async function currentPlan(rel: string): Promise<Plan> {
  const plans = flattenPlanSections((await fetchPlans(TODAY, true)).sections);
  const found = plans.find((plan) => plan.path === rel);
  if (found === undefined) throw new Error(`the list does not hold ${rel}`);
  return found;
}

/** One write that reached the wire, as outward evidence of the sequence. */
interface WriteCall {
  kind: "note" | "done" | "anchor" | "title";
  path: string;
  note?: string;
  done?: boolean;
  title?: string;
}

/**
 * The dependency bag: the real five writes and the two real list reads, plus a
 * debounce the test fires by hand and a gate that holds the next write in the
 * air so a keystroke can land during its round trip.
 */
class HttpSession {
  state: PlanWriteState = createPlanWriteState();
  readonly writes: WriteCall[] = [];
  readonly toasts: PlanToast[] = [];
  /** The list reads asked for, in order (`reload` = silent, `refresh` = visible). */
  readonly reads: string[] = [];
  private autosave: (() => void) | null = null;
  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;

  /** Hold the next write before it goes on the wire. */
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

  /** The wiring's `setTimeout` callback: the debounce fired. */
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

  private async perform(call: WriteCall, send: () => Promise<Plan>): Promise<Plan> {
    this.writes.push(call);
    const gate = this.gate;
    if (gate !== null) {
      this.gate = null;
      await gate;
    }
    return send();
  }

  private async readList(bypassCache: boolean): Promise<Plan[] | null> {
    try {
      return flattenPlanSections((await fetchPlans(TODAY, bypassCache)).sections);
    } catch {
      return null;
    }
  }

  private readonly port: PlanWritePort = {
    writeNote: (input) =>
      this.perform({ kind: "note", path: input.path, note: input.note }, () =>
        updatePlan({
          path: input.path,
          note: input.note,
          expectedMtime: input.expectedMtime ?? undefined,
          force: input.force,
        }),
      ),
    writeDone: (input) =>
      this.perform({ kind: "done", path: input.path, done: input.done }, () =>
        updatePlan({
          path: input.path,
          done: input.done,
          expectedMtime: input.expectedMtime ?? undefined,
          force: input.force,
        }),
      ),
    writeAnchor: (input) =>
      this.perform({ kind: "anchor", path: input.path }, () =>
        updatePlan({
          path: input.path,
          anchor: input.anchor,
          expectedMtime: input.expectedMtime ?? undefined,
          force: input.force,
        }),
      ),
    writeTitle: (input) =>
      this.perform({ kind: "title", path: input.path, title: input.title }, () =>
        updatePlan({
          path: input.path,
          title: input.title,
          expectedMtime: input.expectedMtime ?? undefined,
          force: input.force,
        }),
      ),
    createPlan: (input) => createPlan(input),
    reloadList: async () => {
      this.reads.push("reload");
      return this.readList(true);
    },
    refreshList: async () => {
      this.reads.push("refresh");
      return this.readList(false);
    },
    scheduleSave: () => {
      // The wiring holds the timer; `fireAutosave` is its callback.
      this.autosave = () => undefined;
    },
    cancelSave: () => {
      this.autosave = null;
    },
    toast: (toast) => {
      this.toasts.push(toast);
    },
  };
}

describe("plan writes against the real files: the note", () => {
  it("writes the draft to the file when the debounce fires, and adopts the new mtime", async () => {
    const uid = uniqueId("plans-write");
    const plan = await createPlan({ title: uid, anchor: TODAY_ANCHOR });
    try {
      const session = new HttpSession();
      await session.dispatch({ type: "open_plan", plan });
      await session.dispatch({ type: "note_edited", note: "顺路去银行取号" });
      await session.fireAutosave();

      expect(readPlan(plan.path)).toContain("顺路去银行取号");
      expect(session.state).toMatchObject({ saveStatus: "saved", dirty: false });
      // The mtime the file has now is the one the session guards the next write
      // with — otherwise the very next save would be a false conflict.
      expect(session.state.target?.mtime).toBe((await currentPlan(plan.path)).mtime);

      // …and the next write really does go through.
      await session.dispatch({ type: "note_edited", note: "带上身份证和租房合同" });
      await session.fireAutosave();
      expect(readPlan(plan.path)).toContain("带上身份证和租房合同");
    } finally {
      removePlanFiles([plan.path]);
    }
  });

  it("keeps the keystroke typed during a round trip, and it is the last one on disk", async () => {
    const uid = uniqueId("plans-write");
    const plan = await createPlan({ title: uid, anchor: TODAY_ANCHOR });
    try {
      const session = new HttpSession();
      await session.dispatch({ type: "open_plan", plan });
      await session.dispatch({ type: "note_edited", note: "第一版" });

      session.holdNextWrite();
      const flying = session.fireAutosave();
      // What the user types while the request is in the air.
      await session.dispatch({ type: "note_edited", note: "第二版" });
      session.releaseWrite();
      await flying;

      expect(session.writes.map((write) => write.note)).toEqual(["第一版", "第二版"]);
      const bytes = readPlan(plan.path);
      expect(bytes).toContain("第二版");
      expect(bytes).not.toContain("第一版");
      expect(session.state).toMatchObject({ saveStatus: "saved", dirty: false });
    } finally {
      removePlanFiles([plan.path]);
    }
  });

  it("refuses a stale save, stops asking, and really overwrites when the user says so", async () => {
    const uid = uniqueId("plans-write");
    const plan = await createPlan({ title: uid, anchor: TODAY_ANCHOR });
    try {
      const session = new HttpSession();
      await session.dispatch({ type: "open_plan", plan });

      // An external editor (or the agent) rewrote the file under us.
      const external = "---\ndone: true\ncreated_at: 2020-01-01T00:00:00+08:00\ndone_at:\n---\n\n别人写的备注\n";
      writeFileSync(planAbs(plan.path), external, "utf8");
      const past = new Date(Date.now() - 60_000);
      utimesSync(planAbs(plan.path), past, past);

      await session.dispatch({ type: "note_edited", note: "我的备注" });
      await session.fireAutosave();

      expect(session.state.conflict).toMatchObject({
        path: plan.path,
        code: "modified",
        retry: { kind: "note" },
      });
      expect(readPlan(plan.path)).toBe(external);

      // Nothing typed after the refusal goes out on its own: the user has not
      // answered yet. (This is the "409 is not retried behind your back" rule,
      // measured on the wire.)
      await session.dispatch({ type: "note_edited", note: "又打了一行" });
      await session.fireAutosave();
      expect(session.writes).toHaveLength(1);
      expect(readPlan(plan.path)).toBe(external);

      // 「覆盖」 writes the draft anyway, keeping the frontmatter that is on disk.
      await session.dispatch({ type: "conflict_answered", choice: "overwrite" });
      expect(session.state.conflict).toBeNull();
      const bytes = readPlan(plan.path);
      expect(bytes).toContain("又打了一行");
      expect(bytes).toContain("done: true");
      expect(bytes).toContain("created_at: 2020-01-01T00:00:00+08:00");
    } finally {
      removePlanFiles([plan.path]);
    }
  });

  it("carries a dirty note to the new path when the file was moved away", async () => {
    const uid = uniqueId("plans-write");
    const plan = await createPlan({ title: uid, anchor: TODAY_ANCHOR });
    const moved = `2026-04/2026-04-10-${uid}.md`;
    try {
      const session = new HttpSession();
      await session.dispatch({ type: "open_plan", plan });
      await session.dispatch({ type: "note_edited", note: "改期也别把这段字吃掉" });

      // The user (or the agent) moved the file to another month, keeping the
      // title: the anchor lives in the path, so this is a re-schedule.
      mkdirSync(path.dirname(planAbs(moved)), { recursive: true });
      renameSync(planAbs(plan.path), planAbs(moved));

      await session.fireAutosave();
      expect(session.state.conflict).toMatchObject({ code: "missing", movedTo: moved });
      expect(session.state.dirty).toBe(true);

      await session.dispatch({ type: "conflict_answered", choice: "reload" });
      expect(existsSync(planAbs(plan.path))).toBe(false);
      expect(readPlan(moved)).toContain("改期也别把这段字吃掉");
      expect(session.state.target?.path).toBe(moved);
    } finally {
      removePlanFiles([plan.path, moved]);
    }
  });
});

describe("plan writes against the real files: the row's writes", () => {
  it("stamps completion on the file", async () => {
    const uid = uniqueId("plans-write");
    const plan = await createPlan({ title: uid, anchor: TODAY_ANCHOR });
    try {
      const session = new HttpSession();
      await session.dispatch({ type: "open_plan", plan });
      await session.dispatch({ type: "toggle_done", plan });

      expect(readPlan(plan.path)).toContain("done: true");
      expect((await currentPlan(plan.path)).done).toBe(true);
      expect(session.state.conflict).toBeNull();
    } finally {
      removePlanFiles([plan.path]);
    }
  });

  it("moves the file for a re-schedule without rewriting a byte", async () => {
    const uid = uniqueId("plans-write");
    const plan = await createPlan({ title: uid, anchor: TODAY_ANCHOR });
    const moved = `2026-03/2026-03-16-${uid}.md`;
    try {
      const before = readPlan(plan.path);
      const session = new HttpSession();
      await session.dispatch({ type: "open_plan", plan });
      await session.dispatch({ type: "reschedule", plan, choice: "tomorrow", today: TODAY });

      expect(existsSync(planAbs(plan.path))).toBe(false);
      expect(readPlan(moved)).toBe(before);
      expect(session.state.target?.path).toBe(moved);
      expect(session.reads).toEqual(["reload"]);
    } finally {
      removePlanFiles([plan.path, moved]);
    }
  });

  it("renames the file in place without rewriting a byte", async () => {
    const uid = uniqueId("plans-write");
    const plan = await createPlan({ title: uid, anchor: TODAY_ANCHOR });
    const renamed = `2026-03/2026-03-15-${uid}-改名.md`;
    try {
      const before = readPlan(plan.path);
      const session = new HttpSession();
      await session.dispatch({ type: "open_plan", plan });
      await session.dispatch({ type: "rename", plan, title: `${uid}-改名` });

      expect(existsSync(planAbs(plan.path))).toBe(false);
      expect(readPlan(renamed)).toBe(before);
      expect(session.state.target?.path).toBe(renamed);
      expect(session.reads).toEqual(["reload"]);
    } finally {
      removePlanFiles([plan.path, renamed]);
    }
  });

  it("creates a plan file and re-reads the list", async () => {
    const uid = uniqueId("plans-write");
    const rel = `inbox/${uid}.md`;
    try {
      const session = new HttpSession();
      await session.dispatch({
        type: "create_submitted",
        title: uid,
        anchor: { kind: "inbox" },
      });

      expect(existsSync(planAbs(rel))).toBe(true);
      expect(readPlan(rel)).toContain("done: false");
      expect(session.state.creating).toBe(false);
      // A created plan is not in the list the session was holding: the visible
      // read is what puts it there.
      expect(session.reads).toEqual(["refresh"]);
      expect(session.toasts).toEqual([]);
    } finally {
      removePlanFiles([rel]);
    }
  });

  // The create path cannot produce `name-taken` — the server picks a free file
  // name instead of refusing (ADR-0006) — so the rule slice 1 pinned for it
  // ("a 409 on a create is an error, never a 「覆盖」 offer") is covered by the
  // reducer tests. What *can* collide is a re-schedule, which is what these two
  // drive against the real server.
  it("reports a taken name once and never offers to overwrite the other plan", async () => {
    const uid = uniqueId("plans-write");
    // Two plans share the title; only their anchors (and therefore their paths)
    // differ. Moving one onto the other's name is what the server refuses.
    const inboxPlan = await createPlan({ title: uid, anchor: { kind: "inbox" } });
    const dayPlan = await createPlan({ title: uid, anchor: TODAY_ANCHOR });
    try {
      const inboxBytes = readPlan(inboxPlan.path);
      const dayBytes = readPlan(dayPlan.path);
      const session = new HttpSession();
      await session.dispatch({ type: "open_plan", plan: dayPlan });
      await session.dispatch({ type: "reschedule", plan: dayPlan, choice: "inbox", today: TODAY });

      // One request, no retry: 「覆盖」 is not on the table because nothing was
      // written and there is nothing to overwrite.
      expect(session.writes).toHaveLength(1);
      expect(session.state.conflict).toBeNull();
      expect(session.toasts).toEqual([
        { key: "name_taken", level: "error", description: inboxPlan.path },
      ]);
      expect(readPlan(inboxPlan.path)).toBe(inboxBytes);
      expect(readPlan(dayPlan.path)).toBe(dayBytes);
    } finally {
      removePlanFiles([inboxPlan.path, dayPlan.path]);
    }
  });

  it("keeps 「覆盖」 from clobbering a name the target gained while the notice was up", async () => {
    const uid = uniqueId("plans-write");
    const plan = await createPlan({ title: uid, anchor: TODAY_ANCHOR });
    const tomorrow = "2026-03-16";
    let otherPath: string | null = null;
    try {
      const session = new HttpSession();
      await session.dispatch({ type: "open_plan", plan });

      // The view is stale: an external editor touched the file.
      writeFileSync(planAbs(plan.path), `${readPlan(plan.path)}\n外部备注\n`, "utf8");
      const past = new Date(Date.now() - 60_000);
      utimesSync(planAbs(plan.path), past, past);

      // The move is refused for the stale view, and the target is free at that
      // moment…
      await session.dispatch({ type: "reschedule", plan, choice: "tomorrow", today: TODAY });
      expect(session.state.conflict).toMatchObject({ code: "modified", retry: { kind: "anchor" } });

      // …and somebody else takes the name before the user answers.
      const other = await createPlan({ title: uid, anchor: { kind: "day", date: tomorrow } });
      otherPath = other.path;
      const otherBytes = readPlan(other.path);

      // 「覆盖」 skips the mtime guard, and must still not be able to overwrite a
      // plan that holds the target name: the write really went out with `force`
      // and the server still refused it.
      await session.dispatch({ type: "conflict_answered", choice: "overwrite" });
      expect(session.writes).toHaveLength(2);
      expect(session.toasts.map((toast) => toast.key)).toEqual(["save_failed"]);
      expect(readPlan(other.path)).toBe(otherBytes);
      expect(existsSync(planAbs(plan.path))).toBe(true);
    } finally {
      removePlanFiles([plan.path, ...(otherPath === null ? [] : [otherPath])]);
    }
  });
});
