import { describe, expect, it } from "vitest";
import {
  SCHEDULER_ROOT_PAGE,
  backSchedulerPage,
  createSchedulerPageStack,
  currentSchedulerPage,
  isSchedulerRootPage,
  openSchedulerPage,
  schedulerPagesAfterDelete,
  schedulerPagesAfterSave,
  type SchedulerPage,
} from "@/lib/shared/scheduler-pages";

/**
 * The scheduler panel's page stack (lib/shared/scheduler-pages.ts). Driven as
 * plain data — the store holds the current stack and the panel renders
 * `currentSchedulerPage`. No React, no DOM, no server.
 */

function detail(taskId: string): SchedulerPage {
  return { kind: "detail", taskId };
}

function form(taskId: string | null): SchedulerPage {
  return { kind: "form", taskId };
}

describe("createSchedulerPageStack / currentSchedulerPage", () => {
  it("starts on the task list", () => {
    expect(createSchedulerPageStack()).toEqual([SCHEDULER_ROOT_PAGE]);
  });

  it("resolves an empty stack to the list", () => {
    expect(currentSchedulerPage([])).toEqual(SCHEDULER_ROOT_PAGE);
  });
});

describe("openSchedulerPage", () => {
  it("opens a task detail above the list", () => {
    expect(openSchedulerPage(detail("a"))).toEqual([SCHEDULER_ROOT_PAGE, detail("a")]);
  });

  it("replaces a sibling detail page instead of growing the stack", () => {
    const first = openSchedulerPage(detail("a"));
    const second = openSchedulerPage(detail("b"));
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(second).toEqual([SCHEDULER_ROOT_PAGE, detail("b")]);
  });

  it("nests an edit form above its task's detail page", () => {
    expect(openSchedulerPage(form("a"))).toEqual([SCHEDULER_ROOT_PAGE, detail("a"), form("a")]);
  });

  it("opens the create form straight above the list", () => {
    expect(openSchedulerPage(form(null))).toEqual([SCHEDULER_ROOT_PAGE, form(null)]);
  });
});

describe("backSchedulerPage", () => {
  it("pops one level", () => {
    expect(backSchedulerPage([SCHEDULER_ROOT_PAGE, detail("a"), form("a")])).toEqual([
      SCHEDULER_ROOT_PAGE,
      detail("a"),
    ]);
  });

  it("never lets the stack empty out", () => {
    expect(backSchedulerPage([])).toEqual([SCHEDULER_ROOT_PAGE]);
    expect(backSchedulerPage([SCHEDULER_ROOT_PAGE])).toEqual([SCHEDULER_ROOT_PAGE]);
  });
});

describe("isSchedulerRootPage", () => {
  it("is true only on the list", () => {
    expect(isSchedulerRootPage([SCHEDULER_ROOT_PAGE])).toBe(true);
    expect(isSchedulerRootPage([])).toBe(true);
    expect(isSchedulerRootPage([SCHEDULER_ROOT_PAGE, detail("a")])).toBe(false);
  });
});

describe("convergence", () => {
  it("lands on the saved task's detail page after a save", () => {
    expect(schedulerPagesAfterSave("a")).toEqual([SCHEDULER_ROOT_PAGE, detail("a")]);
  });

  it("draws back to the list after a delete", () => {
    expect(schedulerPagesAfterDelete()).toEqual([SCHEDULER_ROOT_PAGE]);
  });
});
