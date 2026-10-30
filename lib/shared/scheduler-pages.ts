export type SchedulerPage =
  | { kind: "root" }
  | { kind: "detail"; taskId: string }
  | { kind: "form"; taskId: string | null };

export const SCHEDULER_ROOT_PAGE: SchedulerPage = { kind: "root" };

export function createSchedulerPageStack(): SchedulerPage[] {
  return [SCHEDULER_ROOT_PAGE];
}

export function currentSchedulerPage(pages: readonly SchedulerPage[]): SchedulerPage {
  return pages.length > 0 ? pages[pages.length - 1] : SCHEDULER_ROOT_PAGE;
}

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

export function openSchedulerPage(page: SchedulerPage): SchedulerPage[] {
  if (page.kind === "root") return createSchedulerPageStack();
  return [...baseStackFor(page), page];
}

export function backSchedulerPage(pages: readonly SchedulerPage[]): SchedulerPage[] {
  if (pages.length <= 1) return createSchedulerPageStack();
  return pages.slice(0, -1);
}

export function isSchedulerRootPage(pages: readonly SchedulerPage[]): boolean {
  return pages.length <= 1;
}

export function schedulerPagesAfterSave(taskId: string): SchedulerPage[] {
  return openSchedulerPage({ kind: "detail", taskId });
}

export function schedulerPagesAfterDelete(): SchedulerPage[] {
  return createSchedulerPageStack();
}
