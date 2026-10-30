import type { SchedulerTaskForm } from "./scheduler";

export interface SchedulerCloseConditions {
  dirty: boolean;
}

export interface SchedulerCloseConfirm {
  titleKey: string;
  descriptionKey: string;
  confirmLabelKey: string;
}

export const SCHEDULER_DIRTY_CLOSE_CONFIRM: SchedulerCloseConfirm = {
  titleKey: "Discard unsaved changes?",
  descriptionKey: "Your scheduled task changes will be lost.",
  confirmLabelKey: "Discard",
};

export function selectSchedulerCloseConfirm(
  conditions: SchedulerCloseConditions,
): SchedulerCloseConfirm | null {
  return conditions.dirty ? SCHEDULER_DIRTY_CLOSE_CONFIRM : null;
}

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
