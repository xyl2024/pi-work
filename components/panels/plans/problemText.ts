// Wording for the 待整理 (unsorted) feed.
//
// The *classification* lives in `lib/shared/plans.ts` — the parser decides
// which problems a file has. This module only turns one problem code into a
// sentence a human can act on, plus the offending fragment the parser recorded
// (the file name, the bad date, the line it could not read). Pure formatting:
// no DOM, no state, so a missing code is a compile error rather than a blank
// row in the panel.
import type { PlanProblem, PlanProblemCode } from "@/lib/shared/plans";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * One sentence per code, written as the i18n source key. Typed as a full
 * `Record` on purpose: adding a problem code to the parser fails type-checking
 * until it has wording, so no code can reach the panel as a bare identifier.
 */
export const PLAN_PROBLEM_TEXT_KEYS: Record<PlanProblemCode, string> = {
  location: "The file is not in a plan folder (inbox/ or YYYY-MM/)",
  "name-syntax": "The file name does not follow the plan naming rule",
  "date-invalid": "The date in the file name is not a real date",
  "week-not-monday": "A week anchor must be named by its Monday",
  "month-mismatch": "The month folder and the date in the name disagree",
  "frontmatter-syntax": "The frontmatter could not be parsed",
  "frontmatter-done": "done must be true or false",
  "frontmatter-created-at": "created_at is not a valid timestamp",
  "frontmatter-done-at": "done_at is not a valid timestamp",
};

/**
 * One line for one problem: the translated sentence with the offending fragment
 * appended after a colon when the parser recorded one. The fragment is shown
 * verbatim — it is the user's own text, and quoting it is what lets them find
 * the file and the field without guessing.
 */
export function planProblemText(problem: PlanProblem, t: Translate): string {
  const sentence = t(PLAN_PROBLEM_TEXT_KEYS[problem.code]);
  return problem.detail ? `${sentence}: ${problem.detail}` : sentence;
}
