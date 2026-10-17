/**
 * Polling cadence for the scheduler panel view.
 *
 * The scheduler has no event or push channel, so the only way the right-bar
 * badge (and the task list) learns that a background run started or finished is
 * to poll. This module is the one decision about *when*: a pure table from
 * "where is the panel" + "is the browser tab visible" to the next delay, or
 * null for "do not poll".
 *
 * Three tiers, slowest when nobody is looking:
 *
 *   • `runs`      — the scheduler panel is open on a task's run history. Runs
 *     change while a task is in flight, so this is the fast one.
 *   • `panel`     — the scheduler panel is open somewhere else (list / form).
 *     The badge only needs to stay honest, not live.
 *   • `collapsed` — the scheduler panel is not the active open view (collapsed,
 *     or another panel tab is showing). A dot that lights up within half a
 *     minute is enough, and 30s keeps a hidden panel from leaning on the server.
 *
 * A hidden browser tab always stops the loop; the poll resumes on the next
 * tick after visibility returns (see `lib/client/scheduler-store.ts`).
 */

/** How hard the poll leans on the server. */
export type SchedulerPollTier = "runs" | "panel" | "collapsed";

/** Delay per tier, in milliseconds. */
export const SCHEDULER_POLL_MS: Record<SchedulerPollTier, number> = {
  runs: 2_000,
  panel: 10_000,
  collapsed: 30_000,
};

/** What the tier decision reads. */
export interface SchedulerPollConditions {
  /** The scheduler panel is the active, open panel tab (not collapsed, and not
   *  hidden behind another panel tab). */
  panelOpen: boolean;
  /** The open panel is showing a task's run history. */
  runsVisible: boolean;
  /** `document.hidden` — the browser tab is in the background. */
  hidden: boolean;
}

/** Which tier the current panel state belongs to. */
export function schedulerPollTier(conditions: SchedulerPollConditions): SchedulerPollTier {
  if (!conditions.panelOpen) return "collapsed";
  return conditions.runsVisible ? "runs" : "panel";
}

/**
 * The next poll delay, or null when the loop must stop. Hidden is a hard stop
 * for every tier — a background tab should not touch the network.
 */
export function schedulerPollDelayMs(conditions: SchedulerPollConditions): number | null {
  if (conditions.hidden) return null;
  return SCHEDULER_POLL_MS[schedulerPollTier(conditions)];
}
