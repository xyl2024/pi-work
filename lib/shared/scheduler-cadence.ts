export type SchedulerPollTier = "runs" | "idle";

export const SCHEDULER_POLL_MS: Record<SchedulerPollTier, number> = {
  runs: 2_000,
  idle: 10_000,
};

export interface SchedulerPollConditions {
  runsVisible: boolean;
  hidden: boolean;
}

export function schedulerPollTier(conditions: SchedulerPollConditions): SchedulerPollTier {
  return conditions.runsVisible ? "runs" : "idle";
}

export function schedulerPollDelayMs(conditions: SchedulerPollConditions): number | null {
  if (conditions.hidden) return null;
  return SCHEDULER_POLL_MS[schedulerPollTier(conditions)];
}
