/**
 * Page stack for the scheduler panel view.
 *
 * The panel navigates in levels instead of squeezing a list + detail split
 * into a one-third-wide strip. There are three levels:
 *
 *   0. root   — the task list;
 *   1. detail — one task's overview / runs / prompt / config, carrying its id;
 *   2. form   — the create / edit form, carrying the task id or `null` for a
 *      new task.
 *
 * Every page is full width with a back control, so Back always returns one
 * level up. The stack is bounded: opening a sibling detail page replaces the
 * previous one rather than growing. This module owns the rules so they can be
 * driven from `tests/unit` without a browser — `lib/client/scheduler-store.ts`
 * holds the current stack and the panel renders `currentSchedulerPage`.
 *
 * Three convergence rules ride on top of push/back: a successful save lands on
 * the saved task's detail page (the cron is the easiest field to get wrong, so
 * the user must immediately see the computed next run), and a delete draws the
 * stack back to the list.
 */

/** One level of the panel's navigation. */
export type SchedulerPage =
  | { kind: "root" }
  | { kind: "detail"; taskId: string }
  | { kind: "form"; taskId: string | null };

/** The task list — the bottom of every stack. */
export const SCHEDULER_ROOT_PAGE: SchedulerPage = { kind: "root" };

/** A fresh stack, sitting on the task list. */
export function createSchedulerPageStack(): SchedulerPage[] {
  return [SCHEDULER_ROOT_PAGE];
}

/** The page the panel renders: the top of the stack, root when it is empty. */
export function currentSchedulerPage(pages: readonly SchedulerPage[]): SchedulerPage {
  return pages.length > 0 ? pages[pages.length - 1] : SCHEDULER_ROOT_PAGE;
}

/**
 * The pages a page opens onto. A detail page is a root-level sibling of the
 * list; an edit form hangs off its task's detail page (so Back returns to the
 * task), while the "new task" form is a sibling of the list (its detail page
 * does not exist yet).
 */
function baseStackFor(page: SchedulerPage): SchedulerPage[] {
  switch (page.kind) {
    case "root":
      return [];
    case "detail":
      return [SCHEDULER_ROOT_PAGE];
    case "form":
      return page.taskId === null
        ? [SCHEDULER_ROOT_PAGE]
        : [SCHEDULER_ROOT_PAGE, { kind: "detail", taskId: page.taskId }];
  }
}

/**
 * Enter a page. Anything at or above the page's own level is replaced, so
 * sibling navigation (task A → task B) cannot grow the stack.
 */
export function openSchedulerPage(page: SchedulerPage): SchedulerPage[] {
  if (page.kind === "root") return createSchedulerPageStack();
  return [...baseStackFor(page), page];
}

/** Pop one level. The task list is a floor: backing off it is a no-op. */
export function backSchedulerPage(pages: readonly SchedulerPage[]): SchedulerPage[] {
  if (pages.length <= 1) return createSchedulerPageStack();
  return pages.slice(0, -1);
}

/**
 * Whether the stack is sitting on the task list, i.e. an Escape cannot pop a
 * level and the panel is free to run its tab-close rules instead.
 */
export function isSchedulerRootPage(pages: readonly SchedulerPage[]): boolean {
  return pages.length <= 1;
}

/**
 * Where a successful save lands: the saved task's detail page, whatever page
 * the form was opened from. The user must see the recomputed next run.
 */
export function schedulerPagesAfterSave(taskId: string): SchedulerPage[] {
  return openSchedulerPage({ kind: "detail", taskId });
}

/** Where a delete lands: back on the task list, with the deleted task gone. */
export function schedulerPagesAfterDelete(): SchedulerPage[] {
  return createSchedulerPageStack();
}
