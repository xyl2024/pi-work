import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ISOLATED_DATA_DIR } from "../config";
import { api, uniqueId } from "./helpers";
import {
  PLAN_TITLE_MAX_LENGTH,
  sanitizePlanTitle,
  type Plan,
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

  it("rejects an anchor that is not a real inbox/day anchor", async () => {
    const rejected: unknown[] = [
      { kind: "week" },
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
