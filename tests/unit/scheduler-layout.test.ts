import { describe, expect, it } from "vitest";
import {
  SCHEDULER_LIST_WIDTH,
  SCHEDULER_SPLIT_MIN_WIDTH,
  resolveSchedulerLayout,
} from "@/lib/shared/scheduler-layout";

describe("resolveSchedulerLayout", () => {
  it("stays split before the first measurement", () => {
    expect(resolveSchedulerLayout(null)).toBe("split");
  });

  it("stacks a narrow scheduler container", () => {
    expect(resolveSchedulerLayout(0)).toBe("stacked");
    expect(resolveSchedulerLayout(719)).toBe("stacked");
  });

  it("splits once the scheduler container reaches the breakpoint", () => {
    expect(resolveSchedulerLayout(720)).toBe("split");
    expect(resolveSchedulerLayout(721)).toBe("split");
  });

  it("exports positive layout constants", () => {
    expect(SCHEDULER_SPLIT_MIN_WIDTH).toBeGreaterThan(0);
    expect(SCHEDULER_LIST_WIDTH).toBeGreaterThan(0);
  });
});
