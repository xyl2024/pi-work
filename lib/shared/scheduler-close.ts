/**
 * Close guard for the scheduler panel view.
 *
 * The panel tab's × lives in the shell's tab strip, but only the panel knows
 * whether closing it would throw something away. This module is that one
 * question, asked the way the settings modal asks it
 * (`lib/shared/settings-unsaved.ts`): the caller passes the conditions and
 * gets back the confirmation to show, or null when the tab may close without
 * asking.
 *
 * Pure — no React / DOM / server imports — so the decision is driven from
 * `tests/unit`. The shell maps the returned i18n keys through `t()`.
 *
 * Only one condition makes a close lossy: the task form is a saved-item
 * (ADR-0009) — the task list, selection, filters and page-stack position are
 * all cheap to rebuild, and a running task keeps running on the server, so
 * neither of those blocks a silent close. A draft is compared against the
 * snapshot taken when the form opened (see `isSchedulerFormDirty`), so a blank
 * "new task" form opened and closed in one go never prompts.
 */

import type { SchedulerTaskForm } from "./scheduler";

/** What the close decision reads. */
export interface SchedulerCloseConditions {
  /** The open form differs from the snapshot taken when it opened. */
  dirty: boolean;
}

/** The confirmation to show before closing the scheduler tab. */
export interface SchedulerCloseConfirm {
  titleKey: string;
  descriptionKey: string;
  /** Button label for "yes, close and discard". Cancel always keeps the tab. */
  confirmLabelKey: string;
}

/** The confirmation shown when closing would drop unsaved edits. */
export const SCHEDULER_DIRTY_CLOSE_CONFIRM: SchedulerCloseConfirm = {
  titleKey: "Discard unsaved changes?",
  descriptionKey: "Your scheduled task changes will be lost.",
  confirmLabelKey: "Discard",
};

/**
 * The confirmation to show before closing the scheduler tab, or null when it
 * may close silently. Running tasks never guard: the run lives on the server
 * and a background refresh is exactly what the badge is for.
 */
export function selectSchedulerCloseConfirm(
  conditions: SchedulerCloseConditions,
): SchedulerCloseConfirm | null {
  return conditions.dirty ? SCHEDULER_DIRTY_CLOSE_CONFIRM : null;
}

/** True when the form's current values differ from the snapshot it opened with. */
export function isSchedulerFormDirty(
  form: SchedulerTaskForm | null,
  baseline: SchedulerTaskForm | null,
): boolean {
  if (form === null || baseline === null) return false;
  const keys = Object.keys(form) as (keyof SchedulerTaskForm)[];
  for (const key of keys) {
    if (!fieldEqual(form[key], baseline[key])) return true;
  }
  return false;
}

function fieldEqual(a: SchedulerTaskForm[keyof SchedulerTaskForm], b: SchedulerTaskForm[keyof SchedulerTaskForm]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}
