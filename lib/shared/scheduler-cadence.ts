export type SchedulerPollTier = "runs" | "panel" | "collapsed";

export const SCHEDULER_POLL_MS: Record<SchedulerPollTier, number> = {
  runs: 2_000,
  panel: 10_000,
  collapsed: 30_000,
};

export interface SchedulerPollConditions {
  panelOpen: boolean;
  runsVisible: boolean;
  hidden: boolean;
}

export function schedulerPollTier(conditions: SchedulerPollConditions): SchedulerPollTier {
  if (!conditions.panelOpen) return "collapsed";
  return conditions.runsVisible ? "runs" : "panel";
}

export function schedulerPollDelayMs(conditions: SchedulerPollConditions): number | null {
  if (conditions.hidden) return null;
  return SCHEDULER_POLL_MS[schedulerPollTier(conditions)];
}
