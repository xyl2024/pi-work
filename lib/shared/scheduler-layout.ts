export type SchedulerLayout = "split" | "stacked";

export const SCHEDULER_SPLIT_MIN_WIDTH = 720;
export const SCHEDULER_LIST_WIDTH = 300;

export function resolveSchedulerLayout(width: number | null): SchedulerLayout {
  if (width === null) return "split";
  return width >= SCHEDULER_SPLIT_MIN_WIDTH ? "split" : "stacked";
}
