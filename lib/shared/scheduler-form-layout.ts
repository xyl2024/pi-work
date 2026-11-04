export type SchedulerFormLayout = "split" | "stacked";

export const SCHEDULER_FORM_SPLIT_MIN_WIDTH = 640;

export function resolveSchedulerFormLayout(width: number | null): SchedulerFormLayout {
  if (width === null) return "split";
  return width >= SCHEDULER_FORM_SPLIT_MIN_WIDTH ? "split" : "stacked";
}
