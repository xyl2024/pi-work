import { describe, expect, it } from "vitest";
import type { PlanProblem } from "@/lib/shared/plans";
import {
  PLAN_PROBLEM_TEXT_KEYS,
  planProblemText,
} from "@/components/panels/plans/problemText";
import { dictT as t } from "./i18n-dict-stub";

/**
 * The 待整理 feed's wording: one line per parser problem, so the panel can say
 * *what* is wrong with a file instead of dropping it or showing a bare code.
 *
 * The panel passes `useI18n`'s `t`; `dictT` rebuilds it from the real zh
 * dictionary, so a missing or re-worded key fails here (same shape as
 * `plans-anchor-text.test.ts`).
 */
const text = (problem: PlanProblem) => planProblemText(problem, t);

describe("plan problem wording (待整理)", () => {
  it("names a file that sits outside a plan folder", () => {
    expect(text({ code: "location", detail: "notes/x.md" })).toBe(
      "文件不在计划目录里（应为 inbox/ 或 YYYY-MM/）: notes/x.md",
    );
  });

  it("names a file name that does not follow the naming rule", () => {
    expect(text({ code: "name-syntax", detail: "随手记.md" })).toBe(
      "文件名不符合计划命名规则: 随手记.md",
    );
  });

  it("names an impossible date in the file name", () => {
    expect(text({ code: "date-invalid", detail: "2026-13-40" })).toBe(
      "文件名里的日期不是真实日期: 2026-13-40",
    );
  });

  it("names a week anchor that is not a Monday", () => {
    expect(text({ code: "week-not-monday", detail: "2026-09-29" })).toBe(
      "周锚点的日期必须是周一: 2026-09-29",
    );
  });

  it("names a month folder and a date in the name that disagree", () => {
    expect(text({ code: "month-mismatch", detail: "2026-10 ≠ 2026-09" })).toBe(
      "月份目录与文件名里的日期不一致: 2026-10 ≠ 2026-09",
    );
  });

  it("names a frontmatter block that cannot be parsed", () => {
    expect(text({ code: "frontmatter-syntax", detail: "unterminated frontmatter" })).toBe(
      "frontmatter 无法解析: unterminated frontmatter",
    );
  });

  it("names an unparseable done value", () => {
    expect(text({ code: "frontmatter-done", detail: "maybe" })).toBe(
      "done 只能是 true 或 false: maybe",
    );
  });

  it("names an unparseable created_at", () => {
    expect(text({ code: "frontmatter-created-at", detail: "yesterday" })).toBe(
      "created_at 不是合法时间戳: yesterday",
    );
  });

  it("names an unparseable done_at", () => {
    expect(text({ code: "frontmatter-done-at", detail: "2026-13-40" })).toBe(
      "done_at 不是合法时间戳: 2026-13-40",
    );
  });

  it("still reads as a sentence when the parser recorded no fragment", () => {
    expect(text({ code: "name-syntax" })).toBe("文件名不符合计划命名规则");
  });

  it("words every problem code, in Chinese, and words them differently", () => {
    const wordings = Object.entries(PLAN_PROBLEM_TEXT_KEYS).map(([code, key]) => {
      // A key that survives the dictionary lookup untranslated would show the
      // user English; that is the failure this catches.
      expect(key).not.toBe(t(key));
      return text({ code: code as PlanProblem["code"] });
    });
    expect(wordings).toHaveLength(Object.keys(PLAN_PROBLEM_TEXT_KEYS).length);
    expect(new Set(wordings).size).toBe(wordings.length);
    for (const wording of wordings) expect(wording.length).toBeGreaterThan(0);
  });
});
