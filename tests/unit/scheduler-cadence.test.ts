import { describe, expect, it } from "vitest";
import {
  SCHEDULER_POLL_MS,
  schedulerPollDelayMs,
  schedulerPollTier,
} from "@/lib/shared/scheduler-cadence";

describe("schedulerPollTier", () => {
  it("speeds up only while the run history is on screen", () => {
    expect(schedulerPollTier({ runsVisible: true, hidden: false })).toBe("runs");
    expect(schedulerPollTier({ runsVisible: false, hidden: false })).toBe("idle");
  });
});

describe("schedulerPollDelayMs", () => {
  it("uses the runs cadence while the run history is visible", () => {
    expect(schedulerPollDelayMs({ runsVisible: true, hidden: false })).toBe(SCHEDULER_POLL_MS.runs);
  });

  it("keeps polling on the slow cadence after leaving the main view", () => {
    expect(schedulerPollDelayMs({ runsVisible: false, hidden: false })).toBe(SCHEDULER_POLL_MS.idle);
    expect(SCHEDULER_POLL_MS.idle).toBeGreaterThan(SCHEDULER_POLL_MS.runs);
  });

  it("stops entirely while the browser tab is hidden", () => {
    for (const runsVisible of [true, false]) {
      expect(schedulerPollDelayMs({ runsVisible, hidden: true })).toBeNull();
    }
  });

  it("has no tier that stops polling while the page is in front", () => {
    expect(Object.keys(SCHEDULER_POLL_MS).sort()).toEqual(["idle", "runs"]);
  });
});
