import type { SchedulerTaskForm } from "./scheduler";

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
