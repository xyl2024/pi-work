import { describe, expect, it } from "vitest";
import {
  SCHEDULER_POLL_MS,
  schedulerPollDelayMs,
  schedulerPollTier,
  type SchedulerPollConditions,
  type SchedulerPollTier,
} from "@/lib/shared/scheduler-cadence";

/**
 * The scheduler panel's polling cadence (lib/shared/scheduler-cadence.ts).
 * Pure: "where is the panel + is the browser tab visible" → the next delay, or
 * null for "stop". The store is the only caller; this file pins each cell of
 * the state table.
 */

const TIERS: SchedulerPollTier[] = ["runs", "panel", "collapsed"];

describe("schedulerPollTier", () => {
  it("uses the runs tier only while the run history is on screen", () => {
    expect(schedulerPollTier({ mounted: true, runsVisible: true, hidden: false })).toBe("runs");
  });

  it("falls back to the panel tier on the other mounted pages", () => {
    expect(schedulerPollTier({ mounted: true, runsVisible: false, hidden: false })).toBe("panel");
  });

  it("uses the collapsed tier when the panel body is not mounted", () => {
    expect(schedulerPollTier({ mounted: false, runsVisible: false, hidden: false })).toBe("collapsed");
    expect(schedulerPollTier({ mounted: false, runsVisible: true, hidden: false })).toBe("collapsed");
  });
});

describe("schedulerPollDelayMs", () => {
  it("returns the tier's delay when the browser tab is visible", () => {
    for (const tier of TIERS) {
      const conditions =
        tier === "runs"
          ? { mounted: true, runsVisible: true, hidden: false }
          : tier === "panel"
            ? { mounted: true, runsVisible: false, hidden: false }
            : { mounted: false, runsVisible: false, hidden: false };
      expect(schedulerPollDelayMs(conditions)).toBe(SCHEDULER_POLL_MS[tier]);
    }
  });

  it("stops entirely while the browser tab is hidden", () => {
    for (const tier of TIERS) {
      const conditions: SchedulerPollConditions = {
        mounted: tier !== "collapsed",
        runsVisible: tier === "runs",
        hidden: true,
      };
      expect(schedulerPollDelayMs(conditions)).toBeNull();
    }
  });

  it("slows down as the panel gets further out of view", () => {
    expect(SCHEDULER_POLL_MS.runs).toBeLessThan(SCHEDULER_POLL_MS.panel);
    expect(SCHEDULER_POLL_MS.panel).toBeLessThan(SCHEDULER_POLL_MS.collapsed);
  });
});
