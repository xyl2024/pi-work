/**
 * Page stack for the skills panel view.
 *
 * The panel navigates in levels instead of stacking overlays inside a
 * one-third-wide strip. There are exactly two levels:
 *
 *   0. root  — the grid of skills grouped by source;
 *   1. detail — one skill's SKILL.md and attached files, or the add page
 *      (search skills.sh + streaming install log). Both hang directly off the
 *      root, so Back always returns to the grid.
 *
 * The stack is bounded: opening any deeper page replaces whatever a sibling
 * page put there, so root → skill A → skill B → add never grows past two
 * entries. This module owns the rules so they can be driven from
 * `tests/unit` without a browser — `lib/client/skills-store.ts` holds the
 * current stack and the panel renders `currentSkillsPage`.
 */

/** One level of the panel's navigation. */
export type SkillsPage =
  | { kind: "root" }
  | { kind: "detail"; filePath: string }
  | { kind: "add" };

/** The grouped skill grid — the bottom of every stack. */
export const SKILLS_ROOT_PAGE: SkillsPage = { kind: "root" };

/** A fresh stack, sitting on the grid. */
export function createSkillsPageStack(): SkillsPage[] {
  return [SKILLS_ROOT_PAGE];
}

/** The page the panel renders: the top of the stack, root when it is empty. */
export function currentSkillsPage(pages: readonly SkillsPage[]): SkillsPage {
  return pages.length > 0 ? pages[pages.length - 1] : SKILLS_ROOT_PAGE;
}

/**
 * Enter a page. Detail and add are both root-level siblings, so entering one
 * replaces the other instead of growing the stack.
 */
export function openSkillsPage(page: SkillsPage): SkillsPage[] {
  if (page.kind === "root") return createSkillsPageStack();
  return [SKILLS_ROOT_PAGE, page];
}

/** Pop one level. The grid is a floor: backing off it is a no-op. */
export function backSkillsPage(pages: readonly SkillsPage[]): SkillsPage[] {
  if (pages.length <= 1) return createSkillsPageStack();
  return pages.slice(0, -1);
}

/**
 * Whether the stack is sitting on the grid, i.e. an Escape cannot pop a level
 * and the panel is free to run its tab-close rules instead.
 */
export function isSkillsRootPage(pages: readonly SkillsPage[]): boolean {
  return pages.length <= 1;
}
