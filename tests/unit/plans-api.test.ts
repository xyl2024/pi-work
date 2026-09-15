import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ISOLATED_DATA_DIR } from "../config";
import { api, uniqueId } from "./helpers";
import type { PlansResponse, PlanSection } from "@/lib/shared/plans";

/**
 * Interface test for the plans list endpoint against the isolated instance.
 *
 * The plan files are the only input (there is no create API in this slice), so
 * the test seeds its own files under the isolated data root, scopes every
 * assertion to its unique id, and removes them again. The real ~/.pi-work is
 * never touched.
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
