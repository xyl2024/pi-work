import { describe, expect, it } from "vitest";
import {
  PLAN_TITLE_MAX_LENGTH,
  groupPlans,
  isDateKey,
  monthKeyOf,
  parsePlanContent,
  parsePlanPath,
  planFileName,
  planRelativePath,
  planSectionOf,
  sanitizePlanTitle,
  toDateKey,
  type Plan,
  type PlanAnchor,
} from "@/lib/shared/plans";

/** Minimal plan factory — every field not under test gets a stable value. */
function plan(overrides: Partial<Plan> & Pick<Plan, "path" | "title" | "anchor">): Plan {
  return {
    done: false,
    createdAt: null,
    doneAt: null,
    note: "",
    mtime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("plans date keys", () => {
  it("formats a Date as the local calendar day", () => {
    // Constructed in local time, so the key must be the same day regardless
    // of the machine's timezone.
    expect(toDateKey(new Date(2026, 8, 5))).toBe("2026-09-05");
    expect(toDateKey(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("accepts only real calendar dates", () => {
    expect(isDateKey("2026-09-15")).toBe(true);
    expect(isDateKey("2024-02-29")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-2-8")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("nope")).toBe(false);
  });

  it("derives the month directory key", () => {
    expect(monthKeyOf("2026-09-15")).toBe("2026-09");
  });
});

describe("plans path parsing", () => {
  it("parses a day anchor and title out of a month directory", () => {
    expect(parsePlanPath("2026-09/2026-09-15-去办居住证.md")).toEqual({
      ok: true,
      anchor: { kind: "day", date: "2026-09-15" },
      title: "去办居住证",
    });
  });

  it("parses an inbox plan as an anchor-less plan", () => {
    expect(parsePlanPath("inbox/随手记.md")).toEqual({
      ok: true,
      anchor: { kind: "inbox" },
      title: "随手记",
    });
  });

  it("reports a filename with no anchor prefix", () => {
    const result = parsePlanPath("2026-09/随手记.md");
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.map((p) => p.code)).toEqual(["name-syntax"]);
  });

  it("reports an impossible date in the prefix", () => {
    const result = parsePlanPath("2026-13/2026-13-40-x.md");
    expect(result.ok ? [] : result.problems.map((p) => p.code)).toEqual(["date-invalid"]);
  });

  it("reports a day anchor filed under the wrong month", () => {
    const result = parsePlanPath("2026-08/2026-09-15-x.md");
    expect(result.ok ? [] : result.problems.map((p) => p.code)).toEqual(["month-mismatch"]);
  });

  it("reports a file outside the two known layouts", () => {
    for (const path of ["loose.md", "notes/deep/2026-09-15-x.md", "somewhere/x.md"]) {
      const result = parsePlanPath(path);
      expect(result.ok, path).toBe(false);
      expect(result.ok ? [] : result.problems.map((p) => p.code), path).toEqual(["location"]);
    }
  });

  it("reports a non-markdown file in a month directory", () => {
    const result = parsePlanPath("2026-09/2026-09-15-x.txt");
    expect(result.ok ? [] : result.problems.map((p) => p.code)).toEqual(["name-syntax"]);
  });
});

describe("plans filename generation", () => {
  it("round-trips a clean title through generation and parsing", () => {
    const anchor: PlanAnchor = { kind: "day", date: "2026-09-15" };
    expect(planRelativePath(anchor, "去办居住证")).toBe("2026-09/2026-09-15-去办居住证.md");
    expect(parsePlanPath(planRelativePath(anchor, "去办居住证"))).toEqual({
      ok: true,
      anchor,
      title: "去办居住证",
    });
  });

  it("round-trips an inbox title", () => {
    const anchor: PlanAnchor = { kind: "inbox" };
    expect(planRelativePath(anchor, "整理书架")).toBe("inbox/整理书架.md");
    expect(parsePlanPath(planRelativePath(anchor, "整理书架"))).toEqual({
      ok: true,
      anchor,
      title: "整理书架",
    });
  });

  it("replaces path-illegal characters with dashes", () => {
    expect(sanitizePlanTitle('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    expect(planFileName({ kind: "day", date: "2026-09-15" }, "read: a/b")).toBe(
      "2026-09-15-read- a-b.md",
    );
  });

  it("caps an over-long title", () => {
    const long = "计".repeat(PLAN_TITLE_MAX_LENGTH + 40);
    expect(sanitizePlanTitle(long)).toHaveLength(PLAN_TITLE_MAX_LENGTH);
  });

  it("collapses whitespace and trims edge junk", () => {
    expect(sanitizePlanTitle("  buy   milk  ")).toBe("buy milk");
    expect(sanitizePlanTitle("..hidden.")).toBe("hidden");
    expect(sanitizePlanTitle("***")).toBe("");
  });
});

describe("plans frontmatter parsing", () => {
  it("reads the three fields and keeps the body as the note", () => {
    const parsed = parsePlanContent(
      [
        "---",
        "done: true",
        "created_at: 2026-09-14T22:03:11+08:00",
        "done_at: 2026-09-15T09:00:00+08:00",
        "---",
        "",
        "顺路去银行取号，带上身份证和租房合同。",
      ].join("\n"),
    );

    expect(parsed.problems).toEqual([]);
    expect(parsed.meta).toEqual({
      done: true,
      createdAt: "2026-09-14T22:03:11+08:00",
      doneAt: "2026-09-15T09:00:00+08:00",
    });
    expect(parsed.note).toBe("顺路去银行取号，带上身份证和租房合同。");
  });

  it("treats a file with no frontmatter block as an unfinished plan", () => {
    const parsed = parsePlanContent("随手写下的备注\n第二行");

    expect(parsed.problems).toEqual([]);
    expect(parsed.meta).toEqual({ done: false, createdAt: null, doneAt: null });
    expect(parsed.note).toBe("随手写下的备注\n第二行");
  });

  it("defaults missing keys and an empty done_at", () => {
    const parsed = parsePlanContent("---\ndone: false\ndone_at:\n---\nbody");

    expect(parsed.problems).toEqual([]);
    expect(parsed.meta).toEqual({ done: false, createdAt: null, doneAt: null });
  });

  it("ignores keys it does not know", () => {
    const parsed = parsePlanContent("---\npriority: high\ncreated_at: 2026-09-14\n---\nbody");

    expect(parsed.problems).toEqual([]);
    expect(parsed.meta.createdAt).toBe("2026-09-14");
  });

  it("reports an unparseable done value instead of throwing", () => {
    const parsed = parsePlanContent("---\ndone: maybe\n---\nbody");

    expect(parsed.problems.map((p) => p.code)).toEqual(["frontmatter-done"]);
    expect(parsed.meta.done).toBe(false);
  });

  it("reports impossible timestamps", () => {
    const parsed = parsePlanContent("---\ncreated_at: yesterday\ndone_at: 2026-13-40\n---\nbody");

    expect(parsed.problems.map((p) => p.code)).toEqual([
      "frontmatter-created-at",
      "frontmatter-done-at",
    ]);
    expect(parsed.meta.createdAt).toBe(null);
    expect(parsed.meta.doneAt).toBe(null);
  });

  it("reports an unterminated frontmatter block", () => {
    const parsed = parsePlanContent("---\ndone: true\nstill going");

    expect(parsed.problems.map((p) => p.code)).toEqual(["frontmatter-syntax"]);
  });
});

describe("plans sections", () => {
  function sample(): Plan[] {
    return [
      plan({ path: "inbox/随手记.md", title: "随手记", anchor: { kind: "inbox" } }),
      plan({
        path: "2026-09/2026-09-10-旧事.md",
        title: "旧事",
        anchor: { kind: "day", date: "2026-09-10" },
      }),
      plan({
        path: "2026-09/2026-09-01-做完的旧事.md",
        title: "做完的旧事",
        anchor: { kind: "day", date: "2026-09-01" },
        done: true,
      }),
      plan({
        path: "2026-09/2026-09-15-今天.md",
        title: "今天",
        anchor: { kind: "day", date: "2026-09-15" },
      }),
      plan({
        path: "2026-09/2026-09-20-晚点.md",
        title: "晚点",
        anchor: { kind: "day", date: "2026-09-20" },
      }),
      plan({
        path: "2026-09/2026-09-16-明天.md",
        title: "明天",
        anchor: { kind: "day", date: "2026-09-16" },
      }),
    ];
  }

  it("assigns every plan to exactly one section by its anchor", () => {
    const today = "2026-09-15";
    const sections = groupPlans(sample(), today);

    expect(sections.map((section) => section.id)).toEqual([
      "inbox",
      "overdue",
      "today",
      "upcoming",
    ]);
    expect(sections[0].plans.map((p) => p.title)).toEqual(["随手记"]);
    expect(sections[1].plans.map((p) => p.title)).toEqual(["做完的旧事", "旧事"]);
    expect(sections[2].plans.map((p) => p.title)).toEqual(["今天"]);
    expect(sections[3].plans.map((p) => p.title)).toEqual(["明天", "晚点"]);
  });

  it("keeps completed past anchors in the overdue section for the UI to filter", () => {
    // The plugin groups by anchor alone; the overdue *row* is what drops
    // completed plans (and counts the rest). Grouping must not lose them.
    const overdue = groupPlans(sample(), "2026-09-15").find((s) => s.id === "overdue")!;
    expect(overdue.plans.map((p) => p.done)).toEqual([true, false]);
  });

  it("keeps a completed plan in its date section", () => {
    const today = "2026-09-15";
    const target = plan({
      path: "2026-09/2026-09-15-做完.md",
      title: "做完",
      anchor: { kind: "day", date: "2026-09-15" },
      done: true,
    });
    expect(planSectionOf(target, today)).toBe("today");
    expect(groupPlans([target], today)[2].plans).toHaveLength(1);
  });

  it("returns all sections even when there are no plans", () => {
    const sections = groupPlans([], "2026-09-15");
    expect(sections.map((s) => s.id)).toEqual(["inbox", "overdue", "today", "upcoming"]);
    expect(sections.every((s) => s.plans.length === 0)).toBe(true);
  });
});
