import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ISOLATED_DATA_DIR } from "../config";
import { api, uniqueId } from "./helpers";
import {
  PLAN_TITLE_MAX_LENGTH,
  sanitizePlanTitle,
  type Plan,
  type PlanAnchor,
  type PlansResponse,
  type PlanSection,
} from "@/lib/shared/plans";

/**
 * Interface test for the plans endpoints against the isolated instance.
 *
 * The list half seeds its plan files directly under the isolated data root;
 * the create half goes through `POST /api/plans` and reads back through the
 * list. Either way every assertion is scoped to the test's unique id and the
 * files it made are removed again — the real ~/.pi-work is never touched.
 */
const expandTilde = (p: string) => (p.startsWith("~") ? `${os.homedir()}${p.slice(1)}` : p);
const PLANS_ROOT = path.join(expandTilde(ISOLATED_DATA_DIR), "user-plans");

/** Fixed "today" key — sections are computed against the key the client sends. */
const TODAY = "2026-03-15";

function seed(rel: string, content = ""): string {
  const abs = path.join(PLANS_ROOT, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

function sectionOf(data: PlansResponse, id: PlanSection["id"]): PlanSection {
  return data.sections.find((section) => section.id === id)!;
}

function findPlan(data: PlansResponse, exactPath: string) {
  return data.sections
    .flatMap((section) => section.plans)
    .find((plan) => plan.path === exactPath);
}

/** Absolute path of a plan-relative path under the isolated plans root. */
function planAbs(rel: string): string {
  return path.join(PLANS_ROOT, rel);
}

/** Remove the files a test created; the isolated root is shared with other tests. */
function removePlanFiles(paths: readonly string[]): void {
  for (const rel of paths) rmSync(planAbs(rel), { force: true });
}

describe("GET /api/plans", () => {
  it("rejects a missing or malformed today key", async () => {
    expect((await api("/api/plans")).status).toBe(400);
    expect((await api("/api/plans?today=2026-3-5")).status).toBe(400);
    expect((await api("/api/plans?today=2026-02-30")).status).toBe(400);
  });

  it("groups seeded files into sections and reports unusable names as unsorted", async () => {
    const uid = uniqueId("plans");
    const created = [
      seed(`2026-03/2026-03-15-${uid}-today.md`, "今天要做的事"),
      seed(`2026-03/2026-03-10-${uid}-past.md`),
      seed(`2026-03/2026-03-20-${uid}-later.md`),
      seed(`inbox/${uid}-inbox.md`),
      seed(`2026-03/${uid}-broken.md`),
      seed(`2026-03/${uid}-ignored.txt`, "not a plan"),
      seed(`somewhere-else/${uid}/2026-03-15-hidden.md`, "unknown directory"),
    ];
    const createdDirs = [path.join(PLANS_ROOT, "somewhere-else", uid)];
    try {
      const { status, body } = await api(`/api/plans?today=${TODAY}`);
      expect(status).toBe(200);
      const data = body as unknown as PlansResponse;

      expect(data.today).toBe(TODAY);
      expect(data.sections.map((section) => section.id)).toEqual([
        "inbox",
        "overdue",
        "today",
        "week",
        "month",
        "upcoming",
      ]);
      expect(sectionOf(data, "today").plans.map((p) => p.title)).toContain(`${uid}-today`);
      expect(sectionOf(data, "overdue").plans.map((p) => p.title)).toContain(`${uid}-past`);
      expect(sectionOf(data, "upcoming").plans.map((p) => p.title)).toContain(`${uid}-later`);
      expect(sectionOf(data, "inbox").plans.map((p) => p.title)).toContain(`${uid}-inbox`);

      const today = sectionOf(data, "today").plans.find((p) => p.title === `${uid}-today`);
      expect(today?.anchor).toEqual({ kind: "day", date: TODAY });
      expect(today?.note).toBe("今天要做的事");
      expect(today?.done).toBe(false);

      const broken = data.unsorted.find((entry) => entry.path.includes(`${uid}-broken`));
      expect(broken?.problems.map((problem) => problem.code)).toEqual(["name-syntax"]);

      // Non-markdown files and directories outside the two known layouts are
      // not plans and not 待整理 either — the scan leaves them alone.
      expect(data.unsorted.some((entry) => entry.path.includes(`${uid}-ignored`))).toBe(false);
      expect(data.unsorted.some((entry) => entry.path.startsWith("somewhere-else/"))).toBe(false);
      expect(
        data.sections.every((section) =>
          section.plans.every(
            (plan) => !plan.path.includes(`${uid}-ignored`) && !plan.path.includes("somewhere-else"),
          ),
        ),
      ).toBe(true);
    } finally {
      for (const abs of created) rmSync(abs, { force: true });
      for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a file whose frontmatter cannot be parsed", async () => {
    const uid = uniqueId("plans");
    const abs = seed(
      `2026-03/2026-03-15-${uid}-badmeta.md`,
      "---\ndone: maybe\ncreated_at: yesterday\n---\nbody",
    );
    try {
      const { status, body } = await api(`/api/plans?today=${TODAY}`);
      expect(status).toBe(200);
      const entries = (body as unknown as PlansResponse).unsorted;
      const broken = entries.find((entry) => entry.path.includes(`${uid}-badmeta`));
      expect(broken?.problems.map((problem) => problem.code)).toEqual([
        "frontmatter-done",
        "frontmatter-created-at",
      ]);
    } finally {
      rmSync(abs, { force: true });
    }
  });

  it("picks up an external edit on the next read instead of serving a stale cache", async () => {
    const uid = uniqueId("plans");
    const rel = `2026-03/2026-03-15-${uid}-edit.md`;
    const abs = seed(rel, "first");
    try {
      const before = (await api(`/api/plans?today=${TODAY}`)).body as unknown as PlansResponse;
      expect(findPlan(before, rel)?.note).toBe("first");

      writeFileSync(abs, "edited externally and longer", "utf8");
      const after = (await api(`/api/plans?today=${TODAY}`)).body as unknown as PlansResponse;
      expect(findPlan(after, rel)?.note).toBe("edited externally and longer");
    } finally {
      rmSync(abs, { force: true });
    }
  });
});

// ── 待整理 (unsorted files) ────────────────────────────────────────────
// Files that break the naming or frontmatter contract are never dropped and
// never rewritten: they come back as an `unsorted` entry with the reason, the
// panel lists them without any editing control, and a write aimed at one is
// refused instead of silently serialized (which would throw away whatever the
// parser could not read). Fixing the file is the user's job — the next read
// has to take it back into the normal sections.

describe("待整理 (unsorted files)", () => {
  const list = async (refresh = false) =>
    (await api(`/api/plans?today=${TODAY}${refresh ? "&refresh=1" : ""}`)).body as unknown as PlansResponse;
  const unsortedOf = (data: PlansResponse, rel: string) =>
    data.unsorted.find((entry) => entry.path === rel);
  const inAnySection = (data: PlansResponse, rel: string) =>
    data.sections.some((section) => section.plans.some((plan) => plan.path === rel));
  const patch = (body: unknown) =>
    api("/api/plans/file", { method: "PATCH", body: JSON.stringify(body) });

  it("lists every kind of breakage with its path and problems, and never as a plan", async () => {
    const uid = uniqueId("plans");
    // Four ways a hand-written file misses the contract: a name with no anchor
    // prefix, one whose frontmatter does not parse, one filed outside the two
    // known layouts, and one whose name is not a real date.
    const badName = `2026-03/${uid}-随手记.md`;
    const badMeta = `2026-03/2026-03-15-${uid}-badmeta.md`;
    const wrongPlace = `${uid}-loose.md`;
    const badDate = `2026-03/2026-13-40-${uid}-bad-date.md`;
    const seeds: [string, string][] = [
      [badName, "随手写下的东西\n"],
      [badMeta, "---\ndone: maybe\n---\n我的备注\n"],
      [wrongPlace, "躺在根目录\n"],
      [badDate, "日期不存在\n"],
    ];
    try {
      for (const [rel, content] of seeds) seed(rel, content);
      const data = await list();

      expect(unsortedOf(data, badName)?.problems.map((p) => p.code)).toEqual(["name-syntax"]);
      expect(unsortedOf(data, badMeta)?.problems.map((p) => p.code)).toEqual([
        "frontmatter-done",
      ]);
      expect(unsortedOf(data, wrongPlace)?.problems.map((p) => p.code)).toEqual(["location"]);
      expect(unsortedOf(data, badDate)?.problems.map((p) => p.code)).toEqual(["date-invalid"]);

      // Each entry carries the absolute path the panel's "copy path" hands to
      // an external editor, and none of them is a plan.
      for (const [rel] of seeds) {
        expect(unsortedOf(data, rel)?.absPath).toBe(planAbs(rel));
        expect(inAnySection(data, rel)).toBe(false);
      }

      // Reading them back changed nothing on disk: Pi Work has not "fixed"
      // anything on the user's behalf.
      for (const [rel, content] of seeds) {
        expect(readFileSync(planAbs(rel), "utf8")).toBe(content);
      }
    } finally {
      for (const [rel] of seeds) rmSync(planAbs(rel), { force: true });
    }
  });

  it("refuses a write to an unsorted file, even with 覆盖, and keeps its bytes", async () => {
    const uid = uniqueId("plans");
    const byName = `2026-03/${uid}-随手记.md`;
    const byMeta = `2026-03/2026-03-15-${uid}-badmeta.md`;
    try {
      for (const [rel, content] of [
        [byName, "whatever the user wrote"],
        [byMeta, "---\ncreated_at: yesterday\n---\nbody"],
      ] as const) {
        seed(rel, content);
        // `force` is the user's 「覆盖」 answer to a *stale view*; it is not an
        // answer to "this file is not a plan", so the refusal stands.
        for (const body of [
          { path: rel, note: "我的备注", force: true },
          { path: rel, anchor: { kind: "day", date: "2026-04-10" }, force: true },
        ]) {
          const res = await patch(body);
          expect(res.status).toBe(422);
          // The message says it is a format problem, not a permission one.
          expect(String(res.body.error)).toContain("does not follow the plan format");
          expect(readFileSync(planAbs(rel), "utf8")).toBe(content);
        }
      }
    } finally {
      rmSync(planAbs(byName), { force: true });
      rmSync(planAbs(byMeta), { force: true });
    }
  });

  it("takes a file back into the normal sections once the user fixes it", async () => {
    const uid = uniqueId("plans");
    const brokenName = `2026-03/${uid}-随手记.md`;
    const fixedRel = `2026-03/2026-03-15-${uid}-随手记.md`;
    const brokenMeta = `2026-03/2026-03-20-${uid}-badmeta.md`;
    try {
      const nameBody = "---\ndone: false\ncreated_at: 2026-03-01T09:00:00+08:00\ndone_at:\n---\n\n取号\n";
      const metaBody = "---\ndone: true\ncreated_at: 2026-03-02T09:00:00+08:00\ndone_at: 2026-03-03T09:00:00+08:00\n---\n\n还书\n";
      seed(brokenName, nameBody);
      seed(brokenMeta, "---\ndone: maybe\n---\n\n还书\n");

      const before = await list();
      expect(unsortedOf(before, brokenName)).toBeTruthy();
      expect(unsortedOf(before, brokenMeta)).toBeTruthy();

      // The user fixes both outside the panel: renames the badly named file to
      // the contract shape, and repairs the frontmatter in place.
      renameSync(planAbs(brokenName), planAbs(fixedRel));
      writeFileSync(planAbs(brokenMeta), metaBody, "utf8");

      const after = await list(true);
      expect(unsortedOf(after, brokenName)).toBeUndefined();
      expect(unsortedOf(after, brokenMeta)).toBeUndefined();
      expect(sectionOf(after, "today").plans.map((plan) => plan.path)).toContain(fixedRel);

      const repaired = sectionOf(after, "upcoming").plans.find((plan) => plan.path === brokenMeta);
      expect(repaired?.title).toBe(`${uid}-badmeta`);
      expect(repaired?.done).toBe(true);
      expect(repaired?.note).toBe("还书");

      // The bytes on disk are still exactly what the user wrote — the panel
      // read them, it did not round-trip them through the serializer.
      expect(readFileSync(planAbs(fixedRel), "utf8")).toBe(nameBody);
      expect(readFileSync(planAbs(brokenMeta), "utf8")).toBe(metaBody);
    } finally {
      rmSync(planAbs(brokenName), { force: true });
      rmSync(planAbs(fixedRel), { force: true });
      rmSync(planAbs(brokenMeta), { force: true });
    }
  });
});

// ── Create ─────────────────────────────────────────────────────────────
// The write side of the seam: one POST makes exactly one file, and the list
// endpoint must see it again. Everything the client sends is untrusted — the
// title and the anchor both decide where bytes land, so both are pinned here.

describe("POST /api/plans", () => {
  const post = (body: unknown) =>
    api("/api/plans", { method: "POST", body: JSON.stringify(body) });
  const planOf = (body: Record<string, unknown>) => body.plan as unknown as Plan;

  /** Create one plan through the API and return it. */
  async function create(body: unknown): Promise<Plan> {
    const res = await post(body);
    expect(res.status).toBe(201);
    return planOf(res.body);
  }

  it("creates the file, stamps the frontmatter and lists it back for today", async () => {
    const uid = uniqueId("plans");
    const raw = `${uid} ` + "计".repeat(PLAN_TITLE_MAX_LENGTH + 20);
    let rel: string | null = null;
    try {
      const plan = await create({ title: raw, anchor: { kind: "day", date: TODAY } });
      rel = plan.path;
      const clean = sanitizePlanTitle(raw);

      expect(plan.path).toBe(`2026-03/2026-03-15-${clean}.md`);
      expect(plan.title).toBe(clean);
      expect(plan.anchor).toEqual({ kind: "day", date: TODAY });
      expect(plan.done).toBe(false);
      expect(plan.createdAt).not.toBe(null);
      expect(plan.doneAt).toBe(null);
      expect(plan.note).toBe("");

      // On disk: the three-field contract with an empty body.
      expect(readFileSync(planAbs(plan.path), "utf8")).toBe(
        `---\ndone: false\ncreated_at: ${plan.createdAt}\ndone_at:\n---\n`,
      );

      // Create → list round trip.
      const { status, body } = await api(`/api/plans?today=${TODAY}`);
      expect(status).toBe(200);
      const data = body as unknown as PlansResponse;
      expect(findPlan(data, plan.path)?.title).toBe(clean);
      expect(sectionOf(data, "today").plans.some((p) => p.path === plan.path)).toBe(true);
    } finally {
      if (rel !== null) removePlanFiles([rel]);
    }
  });

  it("sanitizes illegal characters and de-duplicates a repeated title", async () => {
    const uid = uniqueId("plans");
    const title = `${uid} read: a/b*c?`;
    const clean = sanitizePlanTitle(title);
    const paths: string[] = [];
    try {
      for (let i = 0; i < 3; i += 1) {
        paths.push((await create({ title, anchor: { kind: "day", date: TODAY } })).path);
      }
      expect(paths).toEqual([
        `2026-03/2026-03-15-${clean}.md`,
        `2026-03/2026-03-15-${clean}-2.md`,
        `2026-03/2026-03-15-${clean}-3.md`,
      ]);

      // The list shows the sanitized title, suffix and all.
      const data = (await api(`/api/plans?today=${TODAY}`)).body as unknown as PlansResponse;
      expect(paths.map((rel) => findPlan(data, rel)?.title)).toEqual([
        clean,
        `${clean}-2`,
        `${clean}-3`,
      ]);
    } finally {
      removePlanFiles(paths);
    }
  });

  it("files a missing or inbox anchor under inbox/", async () => {    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      for (const anchor of [null, { kind: "inbox" }]) {
        const plan = await create({ title: `${uid}-${paths.length}`, anchor });
        expect(plan.path).toBe(`inbox/${uid}-${paths.length}.md`);
        expect(plan.anchor).toEqual({ kind: "inbox" });
        paths.push(plan.path);
      }
      const data = (await api(`/api/plans?today=${TODAY}`)).body as unknown as PlansResponse;
      for (const rel of paths) {
        expect(findPlan(data, rel)).toBeTruthy();
        expect(sectionOf(data, "inbox").plans.some((p) => p.path === rel)).toBe(true);
      }
    } finally {
      removePlanFiles(paths);
    }
  });

  it("files a week anchor under its Monday's month and lists it in 本周", async () => {
    const uid = uniqueId("plans");
    let rel: string | null = null;
    try {
      // 2026-03-09 is the Monday of the week containing TODAY (2026-03-15).
      const plan = await create({ title: uid, anchor: { kind: "week", date: "2026-03-09" } });
      rel = plan.path;
      expect(plan.path).toBe(`2026-03/2026-03-09W-${uid}.md`);
      expect(plan.anchor).toEqual({ kind: "week", date: "2026-03-09" });

      const data = (await api(`/api/plans?today=${TODAY}`)).body as unknown as PlansResponse;
      expect(sectionOf(data, "week").plans.map((p) => p.title)).toContain(uid);
      expect(findPlan(data, rel)?.anchor).toEqual({ kind: "week", date: "2026-03-09" });
    } finally {
      if (rel !== null) removePlanFiles([rel]);
    }
  });

  it("files a month anchor under its month and lists it in 本月", async () => {
    const uid = uniqueId("plans");
    let rel: string | null = null;
    try {
      const plan = await create({ title: uid, anchor: { kind: "month", month: "2026-03" } });
      rel = plan.path;
      expect(plan.path).toBe(`2026-03/2026-03-M-${uid}.md`);
      expect(plan.anchor).toEqual({ kind: "month", month: "2026-03" });

      const data = (await api(`/api/plans?today=${TODAY}`)).body as unknown as PlansResponse;
      expect(sectionOf(data, "month").plans.map((p) => p.title)).toContain(uid);
      expect(findPlan(data, rel)?.anchor).toEqual({ kind: "month", month: "2026-03" });
    } finally {
      if (rel !== null) removePlanFiles([rel]);
    }
  });

  it("keeps a cross-month week in its Monday's month and finds it from the following month", async () => {
    const uid = uniqueId("plans");
    // 2026-03-30 (Mon) – 2026-04-05 (Sun): the week crosses the boundary and
    // is filed under March, named by its Monday. Asking as 2026-04-01 (Wed,
    // inside that week) must find it in the 本周 section.
    const rel = `2026-03/2026-03-30W-${uid}.md`;
    const abs = seed(rel, "");
    try {
      const data = (await api("/api/plans?today=2026-04-01")).body as unknown as PlansResponse;
      expect(findPlan(data, rel)?.anchor).toEqual({ kind: "week", date: "2026-03-30" });
      expect(sectionOf(data, "week").plans.some((p) => p.path === rel)).toBe(true);
      expect(sectionOf(data, "upcoming").plans.some((p) => p.path === rel)).toBe(false);
    } finally {
      rmSync(abs, { force: true });
    }
  });

  it("creates a cross-month week under its Monday's month, not the month it ends in", async () => {
    const uid = uniqueId("plans");
    let rel: string | null = null;
    try {
      // The 2026-03-30 week runs into April; the file is filed under March.
      const plan = await create({ title: uid, anchor: { kind: "week", date: "2026-03-30" } });
      rel = plan.path;
      expect(plan.path).toBe(`2026-03/2026-03-30W-${uid}.md`);

      // …and it shows up in 本周 from a day inside that week.
      const data = (await api("/api/plans?today=2026-04-01")).body as unknown as PlansResponse;
      expect(sectionOf(data, "week").plans.some((p) => p.path === rel)).toBe(true);
    } finally {
      if (rel !== null) removePlanFiles([rel]);
    }
  });

  it("writes the optional note as the body", async () => {
    const uid = uniqueId("plans");
    let rel: string | null = null;
    try {
      const plan = await create({
        title: uid,
        anchor: { kind: "day", date: TODAY },
        note: "顺路去银行取号",
      });
      rel = plan.path;
      expect(plan.note).toBe("顺路去银行取号");
      expect(readFileSync(planAbs(plan.path), "utf8")).toContain("\n顺路去银行取号\n");
    } finally {
      if (rel !== null) removePlanFiles([rel]);
    }
  });

  it("rejects an empty title with a 400 and a named field", async () => {
    for (const title of ["", "   ", "///"]) {
      const res = await post({ title, anchor: { kind: "day", date: TODAY } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Title is required");
      expect(res.body.field).toBe("title");
    }
  });

  it("rejects an anchor that is not a real inbox/day/week/month anchor", async () => {
    const rejected: unknown[] = [
      { kind: "week" },
      { kind: "week", date: "2026-03-15" }, // a Sunday, not a Monday
      { kind: "week", date: "2026-03/../x" },
      { kind: "month" },
      { kind: "month", month: "2026-13" },
      { kind: "month", month: "2026-03-15" },
      { kind: "day" },
      { kind: "day", date: "../../etc" },
      { kind: "day", date: "2026-02-30" },
      { kind: "day", date: "2026-03/../x" },
      "2026-03-15",
    ];
    for (const anchor of rejected) {
      const res = await post({ title: uniqueId("plans"), anchor });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid anchor");
      expect(res.body.field).toBe("anchor");
    }
  });

  it("rejects a body that is not JSON", async () => {
    const res = await api("/api/plans", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid JSON body");
  });

  it("keeps a traversal-shaped title inside the plans root", async () => {
    const uid = uniqueId("plans");
    let rel: string | null = null;
    const escaped = path.join(expandTilde(ISOLATED_DATA_DIR), `escape-${uid}.md`);
    try {
      const plan = await create({ title: `../../escape-${uid}`, anchor: { kind: "day", date: TODAY } });
      rel = plan.path;

      // The separators become dashes and the leading dots are trimmed, so the
      // name cannot climb out of the month directory.
      expect(plan.path).toBe(`2026-03/2026-03-15-escape-${uid}.md`);
      expect(plan.path).not.toContain("..");
      expect(path.resolve(planAbs(plan.path)).startsWith(path.resolve(PLANS_ROOT) + path.sep)).toBe(
        true,
      );
      expect(existsSync(planAbs(plan.path))).toBe(true);
      expect(existsSync(escaped)).toBe(false);
    } finally {
      if (rel !== null) removePlanFiles([rel]);
      rmSync(escaped, { force: true });
    }
  });
});

// ── Update (note / done) ───────────────────────────────────────────────
// The write half of the seam: one PATCH changes one file and the list must
// agree. `expectedMtime` is the reason this endpoint exists separately from
// the create one — it is what keeps a stale panel from silently clobbering an
// agent's or another editor's work — so every branch of that guard (match,
// mismatch, moved away) is pinned here.

describe("PATCH /api/plans/file", () => {
  const patch = (body: unknown) =>
    api("/api/plans/file", { method: "PATCH", body: JSON.stringify(body) });
  const planOf = (body: Record<string, unknown>) => body.plan as unknown as Plan;
  const list = async () =>
    (await api(`/api/plans?today=${TODAY}`)).body as unknown as PlansResponse;

  /** Create one plan through the API and return it (with its mtime). */
  async function create(title: string, anchor: PlanAnchor = { kind: "day", date: TODAY }): Promise<Plan> {
    const res = await api("/api/plans", {
      method: "POST",
      body: JSON.stringify({ title, anchor }),
    });
    expect(res.status).toBe(201);
    return res.body.plan as unknown as Plan;
  }

  it("saves a note, keeps the rest of the frontmatter and lists it back", async () => {
    const uid = uniqueId("plans");
    let plan: Plan | null = null;
    try {
      plan = await create(uid);
      const note = "顺路去银行取号\n带上身份证和租房合同";
      const res = await patch({ path: plan.path, note, expectedMtime: plan.mtime });
      expect(res.status).toBe(200);

      const saved = planOf(res.body);
      expect(saved.note).toBe(note);
      expect(saved.title).toBe(uid);
      expect(saved.done).toBe(false);
      expect(saved.doneAt).toBe(null);
      expect(saved.createdAt).toBe(plan.createdAt);

      // On disk: the three-field contract with the note as the body.
      const text = readFileSync(planAbs(plan.path), "utf8");
      expect(text).toContain(`created_at: ${plan.createdAt}`);
      expect(text.endsWith(`---\n\n${note}\n`)).toBe(true);

      // And the list the panel renders the grey summary from sees the note.
      expect(findPlan(await list(), plan.path)?.note).toBe(note);
      // Saving the same note through the returned mtime works again.
      expect(
        (await patch({ path: plan.path, note: `${note}\n第二行`, expectedMtime: saved.mtime })).status,
      ).toBe(200);
    } finally {
      if (plan !== null) removePlanFiles([plan.path]);
    }
  });

  it("stamps done_at when completing and clears it when un-completing", async () => {
    const uid = uniqueId("plans");
    let plan: Plan | null = null;
    try {
      plan = await create(uid);
      const doneRes = await patch({ path: plan.path, done: true, expectedMtime: plan.mtime });
      expect(doneRes.status).toBe(200);
      const done = planOf(doneRes.body);
      expect(done.done).toBe(true);
      expect(done.doneAt).not.toBe(null);
      expect(readFileSync(planAbs(plan.path), "utf8")).toContain(`done_at: ${done.doneAt}`);

      // A completed plan stays in the section it was in: it is a record, not a
      // removal (the panel fades it in place).
      const afterDone = findPlan(await list(), plan.path);
      expect(afterDone?.done).toBe(true);
      expect(sectionOf(await list(), "today").plans.some((p) => p.path === plan!.path)).toBe(true);

      const undoRes = await patch({ path: done.path, done: false, expectedMtime: done.mtime });
      expect(undoRes.status).toBe(200);
      const undo = planOf(undoRes.body);
      expect(undo.done).toBe(false);
      expect(undo.doneAt).toBe(null);
      expect(readFileSync(planAbs(plan.path), "utf8")).toContain("done_at:\n");
    } finally {
      if (plan !== null) removePlanFiles([plan.path]);
    }
  });

  it("refuses a stale save with 409 and writes nothing", async () => {
    const uid = uniqueId("plans");
    let plan: Plan | null = null;
    try {
      plan = await create(uid);
      // An external editor (or the agent) rewrote the file one minute ago.
      const external =
        "---\ndone: true\ncreated_at: 2020-01-01T00:00:00+08:00\ndone_at:\n---\n\n别人写的备注\n";
      writeFileSync(planAbs(plan.path), external, "utf8");
      const past = new Date(Date.now() - 60_000);
      utimesSync(planAbs(plan.path), past, past);

      const res = await patch({ path: plan.path, note: "我的备注", expectedMtime: plan.mtime });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("modified");
      expect(readFileSync(planAbs(plan.path), "utf8")).toBe(external);

      // 「覆盖」 writes anyway, and still keeps the frontmatter that was on disk.
      const forced = await patch({
        path: plan.path,
        note: "我的备注",
        expectedMtime: plan.mtime,
        force: true,
      });
      expect(forced.status).toBe(200);
      const saved = planOf(forced.body);
      expect(saved.note).toBe("我的备注");
      expect(saved.done).toBe(true);
      expect(saved.createdAt).toBe("2020-01-01T00:00:00+08:00");
    } finally {
      if (plan !== null) removePlanFiles([plan.path]);
    }
  });

  it("reports where a moved plan went, and saves there after reload", async () => {
    const uid = uniqueId("plans");
    let oldRel: string | null = null;
    let newRel: string | null = null;
    try {
      const plan = await create(uid);
      oldRel = plan.path;
      // The user (or the agent) moved the file to another month, keeping the
      // title: the anchor lives in the path, so this is a re-schedule.
      newRel = `2026-04/2026-04-10-${uid}.md`;
      mkdirSync(path.dirname(planAbs(newRel)), { recursive: true });
      renameSync(planAbs(oldRel), planAbs(newRel));

      const res = await patch({ path: oldRel, note: "我的备注", expectedMtime: plan.mtime });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("missing");
      expect(res.body.movedTo).toBe(newRel);

      // 「重载到新位置」: re-read the list, then save against the new path — the
      // note the user had typed is not lost.
      const moved = findPlan(await list(), newRel);
      expect(moved?.title).toBe(uid);
      const saved = await patch({
        path: newRel,
        note: "我的备注",
        expectedMtime: moved!.mtime,
      });
      expect(saved.status).toBe(200);
      expect(planOf(saved.body).path).toBe(newRel);
      expect(readFileSync(planAbs(newRel), "utf8")).toContain("我的备注");
    } finally {
      removePlanFiles([oldRel, newRel].filter((rel): rel is string => rel !== null));
    }
  });

  it("does not guess a new location when more than one plan shares the title", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      // Two plans with the same title in different months: after one of them is
      // moved, a title match is a coin flip rather than an answer.
      const first = await create(uid);
      const second = await create(uid, { kind: "day", date: "2026-04-10" });
      paths.push(first.path, second.path);
      const movedRel = `2026-04/2026-04-20-${uid}.md`;
      paths.push(movedRel);
      renameSync(planAbs(first.path), planAbs(movedRel));

      const res = await patch({ path: first.path, note: "我的备注", expectedMtime: first.mtime });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("missing");
      expect(res.body.movedTo).toBe(null);
    } finally {
      removePlanFiles(paths);
    }
  });

  it("recreates the old path when the user overwrites after a move", async () => {
    const uid = uniqueId("plans");
    let oldRel: string | null = null;
    let newRel: string | null = null;
    try {
      const plan = await create(uid);
      oldRel = plan.path;
      newRel = `2026-04/2026-04-10-${uid}.md`;
      mkdirSync(path.dirname(planAbs(newRel)), { recursive: true });
      renameSync(planAbs(oldRel), planAbs(newRel));

      const res = await patch({ path: oldRel, note: "我的备注", force: true });
      expect(res.status).toBe(200);
      expect(planOf(res.body).path).toBe(oldRel);
      expect(readFileSync(planAbs(oldRel), "utf8")).toContain("我的备注");
    } finally {
      removePlanFiles([oldRel, newRel].filter((rel): rel is string => rel !== null));
    }
  });

  it("refuses to rewrite a file that does not follow the plan format", async () => {
    const uid = uniqueId("plans");
    // A hand-written file whose name has no anchor prefix, and one whose
    // frontmatter cannot be understood: both are 待整理, and serializing either
    // would throw away whatever the parser could not read.
    const byName = seed(`2026-03/${uid}-随手记.md`, "whatever the user wrote");
    const byMeta = seed(`2026-03/2026-03-15-${uid}-badmeta.md`, "---\ndone: maybe\n---\nbody");
    try {
      for (const abs of [byName, byMeta]) {
        const before = readFileSync(abs, "utf8");
        const rel = path.relative(PLANS_ROOT, abs).split(path.sep).join("/");
        const res = await patch({
          path: rel,
          note: "我的备注",
          expectedMtime: statSync(abs).mtime.toISOString(),
        });
        expect(res.status).toBe(422);
        expect(String(res.body.error)).toContain("plan format");
        expect(readFileSync(abs, "utf8")).toBe(before);
      }
    } finally {
      rmSync(byName, { force: true });
      rmSync(byMeta, { force: true });
    }
  });

  it("rejects a malformed request before touching the filesystem", async () => {
    const uid = uniqueId("plans");
    let plan: Plan | null = null;
    try {
      plan = await create(uid);
      const cases: { body: unknown; error: string }[] = [
        { body: { note: "x" }, error: "Missing 'path' field" },
        { body: { path: plan.path, expectedMtime: plan.mtime }, error: "Nothing to update" },
        { body: { path: plan.path, note: "x" }, error: "expectedMtime is required" },
        { body: { path: plan.path, note: 5 }, error: "'note' must be a string" },
        { body: { path: plan.path, done: "yes" }, error: "'done' must be a boolean" },
      ];
      for (const { body, error } of cases) {
        const res = await patch(body);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe(error);
      }
      expect((await api("/api/plans/file", { method: "PATCH", body: "not json" })).status).toBe(400);
      // The file is untouched by any of it.
      expect(findPlan(await list(), plan.path)?.note).toBe("");
    } finally {
      if (plan !== null) removePlanFiles([plan.path]);
    }
  });

  it("keeps a traversal-shaped path inside the plans root", async () => {
    const uid = uniqueId("plans");
    const outside = path.join(expandTilde(ISOLATED_DATA_DIR), `escape-${uid}.md`);
    writeFileSync(outside, "keep me", "utf8");
    try {
      for (const rel of [`../escape-${uid}.md`, `../../escape-${uid}.md`, "etc/passwd"]) {
        const res = await patch({ path: rel, note: "我的备注", expectedMtime: "x", force: true });
        expect(res.status).toBe(422);
      }
      expect(readFileSync(outside, "utf8")).toBe("keep me");
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

// ── Re-schedule (anchor) ──────────────────────────────────────────────
// A different anchor is a different path: the anchor lives in the filename
// (ADR-0006), so re-scheduling *is* a move. These pin the three transitions
// the panel offers (inbox → day, month → month, anchored → inbox), the field
// survival across the move, and the one case that must never silently
// succeed: a target that is already taken.

describe("PATCH /api/plans/file — re-schedule", () => {
  const patch = (body: unknown) =>
    api("/api/plans/file", { method: "PATCH", body: JSON.stringify(body) });
  const list = async (refresh = false) =>
    (await api(`/api/plans?today=${TODAY}${refresh ? "&refresh=1" : ""}`)).body as unknown as PlansResponse;

  async function create(title: string, anchor: PlanAnchor, note?: string): Promise<Plan> {
    const res = await api("/api/plans", {
      method: "POST",
      body: JSON.stringify({ title, anchor, note }),
    });
    expect(res.status).toBe(201);
    return res.body.plan as unknown as Plan;
  }

  it("moves an inbox plan to a day anchor, keeping created_at, note and done", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const inbox = await create(uid, { kind: "inbox" }, "顺路取号");
      paths.push(inbox.path);
      // Complete it first, so the move has a done state to carry.
      const doneRes = await patch({ path: inbox.path, done: true, expectedMtime: inbox.mtime });
      expect(doneRes.status).toBe(200);
      const done = doneRes.body.plan as unknown as Plan;

      const res = await patch({
        path: inbox.path,
        anchor: { kind: "day", date: "2026-03-16" },
        expectedMtime: done.mtime,
      });
      expect(res.status).toBe(200);
      const moved = res.body.plan as unknown as Plan;
      paths.push(moved.path);

      expect(moved.path).toBe(`2026-03/2026-03-16-${uid}.md`);
      expect(moved.anchor).toEqual({ kind: "day", date: "2026-03-16" });
      expect(moved.title).toBe(uid);
      expect(moved.createdAt).toBe(done.createdAt);
      expect(moved.done).toBe(true);
      expect(moved.doneAt).toBe(done.doneAt);
      expect(moved.note).toBe("顺路取号");

      // The old location leaves no residue and the list moves the plan out of
      // 收件箱 into the section its new anchor decides.
      expect(existsSync(planAbs(inbox.path))).toBe(false);
      expect(existsSync(planAbs(moved.path))).toBe(true);
      const data = await list();
      expect(findPlan(data, inbox.path)).toBeUndefined();
      expect(sectionOf(data, "inbox").plans.some((p) => p.path === moved.path)).toBe(false);
      expect(sectionOf(data, "upcoming").plans.some((p) => p.path === moved.path)).toBe(true);
    } finally {
      removePlanFiles(paths);
    }
  });

  it("moves a plan to another month and leaves the bytes untouched", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const original = await create(uid, { kind: "day", date: TODAY }, "带上租房合同");
      paths.push(original.path);
      const before = readFileSync(planAbs(original.path), "utf8");

      const res = await patch({
        path: original.path,
        anchor: { kind: "day", date: "2026-04-10" },
        expectedMtime: original.mtime,
      });
      expect(res.status).toBe(200);
      const moved = res.body.plan as unknown as Plan;
      paths.push(moved.path);

      expect(moved.path).toBe(`2026-04/2026-04-10-${uid}.md`);
      expect(moved.createdAt).toBe(original.createdAt);
      expect(moved.note).toBe("带上租房合同");
      expect(moved.done).toBe(false);
      expect(existsSync(planAbs(original.path))).toBe(false);
      // A pure re-schedule is a rename: the file is byte-for-byte the same.
      expect(readFileSync(planAbs(moved.path), "utf8")).toBe(before);
    } finally {
      removePlanFiles(paths);
    }
  });

  it("returns a plan to the inbox when the anchor is cleared", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const original = await create(uid, { kind: "day", date: TODAY }, "先放一放");
      paths.push(original.path);

      const res = await patch({
        path: original.path,
        anchor: { kind: "inbox" },
        expectedMtime: original.mtime,
      });
      expect(res.status).toBe(200);
      const moved = res.body.plan as unknown as Plan;
      paths.push(moved.path);

      expect(moved.path).toBe(`inbox/${uid}.md`);
      expect(moved.anchor).toEqual({ kind: "inbox" });
      expect(moved.createdAt).toBe(original.createdAt);
      expect(moved.note).toBe("先放一放");
      expect(existsSync(planAbs(original.path))).toBe(false);

      const data = await list();
      expect(sectionOf(data, "inbox").plans.some((p) => p.path === moved.path)).toBe(true);
    } finally {
      removePlanFiles(paths);
    }
  });

  it("refuses to overwrite a plan that already has the target name", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const original = await create(uid, { kind: "day", date: TODAY }, "我原来的备注");
      const other = await create(uid, { kind: "day", date: "2026-04-10" }, "别人的备注");
      paths.push(original.path, other.path);
      const otherBytes = readFileSync(planAbs(other.path), "utf8");

      const res = await patch({
        path: original.path,
        anchor: { kind: "day", date: "2026-04-10" },
        expectedMtime: original.mtime,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("name-taken");
      expect(res.body.target).toBe(other.path);

      // Neither file moved and neither was rewritten.
      expect(existsSync(planAbs(original.path))).toBe(true);
      expect(readFileSync(planAbs(other.path), "utf8")).toBe(otherBytes);
      expect(readFileSync(planAbs(original.path), "utf8")).toContain("我原来的备注");
    } finally {
      removePlanFiles(paths);
    }
  });

  it("reports a taken target even when the view is also stale", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const original = await create(uid, { kind: "day", date: TODAY });
      const other = await create(uid, { kind: "day", date: "2026-04-10" });
      paths.push(original.path, other.path);
      // The source is stale *and* the target is occupied: the occupied target is
      // what the user must hear about, since 「覆盖」 must not clobber the other
      // plan. Pinned so the check order (before the mtime guard) cannot drift.
      const abs = planAbs(original.path);
      writeFileSync(abs, `${readFileSync(abs, "utf8")}\n外部备注\n`, "utf8");
      const past = new Date(Date.now() - 60_000);
      utimesSync(abs, past, past);

      const res = await patch({
        path: original.path,
        anchor: { kind: "day", date: "2026-04-10" },
        expectedMtime: original.mtime,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("name-taken");
    } finally {
      removePlanFiles(paths);
    }
  });

  it("never overwrites the target even when the user picks 覆盖", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const original = await create(uid, { kind: "day", date: TODAY }, "我的备注");
      const other = await create(uid, { kind: "day", date: "2026-04-10" }, "别人的备注");
      paths.push(original.path, other.path);
      const otherBytes = readFileSync(planAbs(other.path), "utf8");

      const res = await patch({
        path: original.path,
        anchor: { kind: "day", date: "2026-04-10" },
        force: true,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("name-taken");
      expect(readFileSync(planAbs(other.path), "utf8")).toBe(otherBytes);
    } finally {
      removePlanFiles(paths);
    }
  });

  it("treats a PATCH that restates the anchor as no move", async () => {    const uid = uniqueId("plans");
    let plan: Plan | null = null;
    try {
      plan = await create(uid, { kind: "day", date: TODAY });
      const res = await patch({
        path: plan.path,
        anchor: { kind: "day", date: TODAY },
        expectedMtime: plan.mtime,
      });
      expect(res.status).toBe(200);
      expect((res.body.plan as unknown as Plan).path).toBe(plan.path);
      expect(existsSync(planAbs(plan.path))).toBe(true);
    } finally {
      if (plan !== null) removePlanFiles([plan.path]);
    }
  });

  it("rejects a malformed anchor before touching the filesystem", async () => {
    const uid = uniqueId("plans");
    let plan: Plan | null = null;
    try {
      plan = await create(uid, { kind: "day", date: TODAY });
      const rejected: unknown[] = [
        { kind: "week", date: "2026-03-15" }, // a Sunday, not a Monday
        { kind: "month", month: "2026-13" },
        { kind: "day", date: "2026-02-30" },
        { kind: "day", date: "../../etc" },
        "2026-03-16",
      ];
      for (const anchor of rejected) {
        const res = await patch({ path: plan.path, anchor, expectedMtime: plan.mtime });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid anchor");
        expect(res.body.field).toBe("anchor");
      }
      expect(existsSync(planAbs(plan.path))).toBe(true);
    } finally {
      if (plan !== null) removePlanFiles([plan.path]);
    }
  });

  it("refuses a re-schedule from a stale view and does not move the file", async () => {
    const uid = uniqueId("plans");
    let plan: Plan | null = null;
    try {
      plan = await create(uid, { kind: "day", date: TODAY });
      // An editor (or the agent) touched the file after the panel read it.
      const abs = planAbs(plan.path);
      writeFileSync(abs, `${readFileSync(abs, "utf8")}\n外部备注\n`, "utf8");
      const past = new Date(Date.now() - 60_000);
      utimesSync(abs, past, past);

      const res = await patch({
        path: plan.path,
        anchor: { kind: "day", date: "2026-04-10" },
        expectedMtime: plan.mtime,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("modified");
      expect(existsSync(abs)).toBe(true);
      expect(existsSync(planAbs(`2026-04/2026-04-10-${uid}.md`))).toBe(false);
    } finally {
      if (plan !== null) removePlanFiles([plan.path]);
    }
  });

  it("refuses to re-schedule a file that does not follow the plan format", async () => {
    const uid = uniqueId("plans");
    const rel = `2026-03/${uid}-随手记.md`;
    const abs = seed(rel, "whatever the user wrote");
    try {
      const res = await patch({
        path: rel,
        anchor: { kind: "day", date: "2026-04-10" },
        expectedMtime: statSync(abs).mtime.toISOString(),
      });
      expect(res.status).toBe(422);
      expect(readFileSync(abs, "utf8")).toBe("whatever the user wrote");
      expect(existsSync(planAbs(`2026-04/2026-04-10-${uid}-随手记.md`))).toBe(false);
    } finally {
      rmSync(abs, { force: true });
    }
  });

  it("reflects a move made in the file manager on the next refresh", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const original = await create(uid, { kind: "day", date: TODAY }, "外部改期");
      paths.push(original.path);
      // The user drags the file to another month in their file manager. The
      // panel hears nothing (there is no watcher), so a refresh must re-read.
      const movedRel = `2026-05/2026-05-20-${uid}.md`;
      paths.push(movedRel);
      mkdirSync(path.dirname(planAbs(movedRel)), { recursive: true });
      renameSync(planAbs(original.path), planAbs(movedRel));

      const data = await list(true);
      expect(findPlan(data, original.path)).toBeUndefined();
      expect(findPlan(data, movedRel)?.anchor).toEqual({ kind: "day", date: "2026-05-20" });
      expect(findPlan(data, movedRel)?.note).toBe("外部改期");
    } finally {
      removePlanFiles(paths);
    }
  });
});

// ── Rename (title) ────────────────────────────────────────────────────
// The title is the second half of the file name and the anchor the first
// (ADR-0006), so renaming is a rename *in place*: the date must not move, the
// section must not change, and `created_at` / the note / the completion state
// must survive. It is guarded by the same `expectedMtime` as every other write.

describe("PATCH /api/plans/file — rename", () => {
  const patch = (body: unknown) =>
    api("/api/plans/file", { method: "PATCH", body: JSON.stringify(body) });
  const list = async () =>
    (await api(`/api/plans?today=${TODAY}`)).body as unknown as PlansResponse;

  async function create(title: string, anchor: PlanAnchor, note?: string): Promise<Plan> {
    const res = await api("/api/plans", {
      method: "POST",
      body: JSON.stringify({ title, anchor, note }),
    });
    expect(res.status).toBe(201);
    return res.body.plan as unknown as Plan;
  }

  it("renames a plan in place, keeping its date, section and metadata", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const original = await create(`${uid}-旧名`, { kind: "day", date: TODAY }, "带上身份证");
      paths.push(original.path);

      const res = await patch({
        path: original.path,
        title: `${uid}-新名字`,
        expectedMtime: original.mtime,
      });
      expect(res.status).toBe(200);
      const renamed = res.body.plan as unknown as Plan;
      paths.push(renamed.path);

      expect(renamed.path).toBe(`2026-03/2026-03-15-${uid}-新名字.md`);
      expect(renamed.title).toBe(`${uid}-新名字`);
      // The anchor is the *other* half of the name, so it did not move — which
      // is the whole point of a rename as opposed to a re-schedule.
      expect(renamed.anchor).toEqual(original.anchor);
      expect(renamed.createdAt).toBe(original.createdAt);
      expect(renamed.done).toBe(false);
      expect(renamed.note).toBe("带上身份证");

      // The old name leaves no residue and the plan stays in the section its
      // (unchanged) anchor decides.
      expect(existsSync(planAbs(original.path))).toBe(false);
      const data = await list();
      expect(findPlan(data, original.path)).toBeUndefined();
      expect(sectionOf(data, "today").plans.some((plan) => plan.path === renamed.path)).toBe(true);
    } finally {
      removePlanFiles(paths);
    }
  });

  it("sanitizes a typed title instead of handing it to the filesystem", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const original = await create(`${uid}-旧名`, { kind: "inbox" }, "先放一放");
      paths.push(original.path);

      const res = await patch({
        path: original.path,
        title: `去办 ${uid}/护照`,
        expectedMtime: original.mtime,
      });
      expect(res.status).toBe(200);
      const renamed = res.body.plan as unknown as Plan;
      paths.push(renamed.path);

      expect(renamed.title).toBe(`去办 ${uid}-护照`);
      // An inbox plan stays in the inbox: a rename never touches the anchor
      // half of the name, and the sanitizer cannot invent a path segment.
      expect(renamed.path).toBe(`inbox/去办 ${uid}-护照.md`);
      expect(renamed.note).toBe("先放一放");
    } finally {
      removePlanFiles(paths);
    }
  });

  it("refuses a name another plan in the same folder already has", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const original = await create(`${uid}-旧名`, { kind: "day", date: TODAY }, "我的备注");
      // The same day, so the target name collides on the whole file name: the
      // anchor prefix is identical and only the title half would change.
      const other = await create(`${uid}-占用`, { kind: "day", date: TODAY }, "别人的备注");
      paths.push(original.path, other.path);
      const otherBytes = readFileSync(planAbs(other.path), "utf8");

      const res = await patch({
        path: original.path,
        title: `${uid}-占用`,
        expectedMtime: original.mtime,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("name-taken");
      expect(res.body.target).toBe(other.path);

      // 「覆盖」 must not let one plan eat another, and neither file was
      // renamed or rewritten.
      const forced = await patch({ path: original.path, title: `${uid}-占用`, force: true });
      expect(forced.status).toBe(409);
      expect(existsSync(planAbs(original.path))).toBe(true);
      expect(readFileSync(planAbs(other.path), "utf8")).toBe(otherBytes);
    } finally {
      removePlanFiles(paths);
    }
  });

  it("rejects an empty, blank or all-illegal title before writing", async () => {
    const uid = uniqueId("plans");
    let plan: Plan | null = null;
    try {
      plan = await create(`${uid}-旧名`, { kind: "day", date: TODAY });
      for (const title of ["", "   ", "///"]) {
        const res = await patch({ path: plan.path, title, expectedMtime: plan.mtime });
        expect(res.status).toBe(400);
      }
      const notString = await patch({ path: plan.path, title: 42, expectedMtime: plan.mtime });
      expect(notString.status).toBe(400);
      expect(notString.body.field).toBe("title");
      expect(existsSync(planAbs(plan.path))).toBe(true);
    } finally {
      if (plan !== null) removePlanFiles([plan.path]);
    }
  });

  it("applies a rename and a re-schedule in one write", async () => {
    const uid = uniqueId("plans");
    const paths: string[] = [];
    try {
      const original = await create(`${uid}-旧名`, { kind: "day", date: TODAY }, "一起改");
      paths.push(original.path);

      const res = await patch({
        path: original.path,
        title: `${uid}-新名字`,
        anchor: { kind: "day", date: "2026-04-10" },
        expectedMtime: original.mtime,
      });
      expect(res.status).toBe(200);
      const updated = res.body.plan as unknown as Plan;
      paths.push(updated.path);

      expect(updated.path).toBe(`2026-04/2026-04-10-${uid}-新名字.md`);
      expect(updated.anchor).toEqual({ kind: "day", date: "2026-04-10" });
      expect(updated.createdAt).toBe(original.createdAt);
      expect(updated.note).toBe("一起改");
    } finally {
      removePlanFiles(paths);
    }
  });

  it("refuses a rename from a stale view and does not touch the file", async () => {
    const uid = uniqueId("plans");
    let plan: Plan | null = null;
    try {
      plan = await create(`${uid}-旧名`, { kind: "day", date: TODAY });
      // An editor (or the agent) touched the file after the panel read it.
      const abs = planAbs(plan.path);
      writeFileSync(abs, `${readFileSync(abs, "utf8")}\n外部备注\n`, "utf8");
      const past = new Date(Date.now() - 60_000);
      utimesSync(abs, past, past);

      const res = await patch({
        path: plan.path,
        title: `${uid}-新名字`,
        expectedMtime: plan.mtime,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("modified");
      expect(existsSync(abs)).toBe(true);
      expect(existsSync(planAbs(`2026-03/2026-03-15-${uid}-新名字.md`))).toBe(false);
    } finally {
      if (plan !== null) removePlanFiles([plan.path]);
    }
  });

  it("refuses to rename a file that does not follow the plan format", async () => {
    const uid = uniqueId("plans");
    const rel = `2026-03/${uid}-随手记.md`;
    const abs = seed(rel, "whatever the user wrote");
    try {
      const res = await patch({
        path: rel,
        title: `${uid}-新名字`,
        expectedMtime: statSync(abs).mtime.toISOString(),
      });
      expect(res.status).toBe(422);
      expect(readFileSync(abs, "utf8")).toBe("whatever the user wrote");
    } finally {
      rmSync(abs, { force: true });
    }
  });
});

// ── Delete ────────────────────────────────────────────────────────────
// Deletion is the one destructive operation the panel offers, so the API is
// pinned on both halves: it really removes the plan, and it cannot be steered
// outside the plans root.

describe("DELETE /api/plans/file", () => {
  const del = (rel: string) =>
    api(`/api/plans/file?path=${encodeURIComponent(rel)}`, { method: "DELETE" });

  async function create(title: string): Promise<Plan> {
    const res = await api("/api/plans", {
      method: "POST",
      body: JSON.stringify({ title, anchor: { kind: "day", date: TODAY } }),
    });
    expect(res.status).toBe(201);
    return res.body.plan as unknown as Plan;
  }

  it("deletes the file and drops it from the list", async () => {
    const uid = uniqueId("plans");
    const plan = await create(uid);
    try {
      expect((await del(plan.path)).status).toBe(200);
      expect(existsSync(planAbs(plan.path))).toBe(false);

      const data = (await api(`/api/plans?today=${TODAY}`)).body as unknown as PlansResponse;
      expect(findPlan(data, plan.path)).toBeUndefined();
      // Deleting it again is a plain 404, not a silent success.
      expect((await del(plan.path)).status).toBe(404);
    } finally {
      removePlanFiles([plan.path]);
    }
  });

  it("requires a path and never reaches outside the plans root", async () => {
    expect((await api("/api/plans/file", { method: "DELETE" })).status).toBe(400);
    const uid = uniqueId("plans");
    const outside = path.join(expandTilde(ISOLATED_DATA_DIR), `escape-${uid}.md`);
    writeFileSync(outside, "keep me", "utf8");
    try {
      const res = await del(`../escape-${uid}.md`);
      expect(res.status).toBe(404);
      expect(existsSync(outside)).toBe(true);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});
