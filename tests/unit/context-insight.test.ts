import { describe, expect, it } from "vitest";
import { isContextInsightRefreshEvent } from "@/lib/shared/context-insight";
import type { SessionEvent } from "@/lib/shared/session-events";

describe("isContextInsightRefreshEvent", () => {
  it("refreshes when the agent settles", () => {
    expect(isContextInsightRefreshEvent({ type: "agent_settled" })).toBe(true);
  });

  it("refreshes when compaction ends", () => {
    expect(
      isContextInsightRefreshEvent({
        type: "compaction_end",
        reason: "threshold",
        result: null,
        aborted: false,
        willRetry: false,
      }),
    ).toBe(true);
  });

  it("ignores other session events", () => {
    const events: SessionEvent[] = [
      { type: "agent_start" },
      { type: "agent_end", messages: [], willRetry: false },
      { type: "compaction_start", reason: "manual" },
      { type: "message_start", message: {} },
      { type: "thinking_level_changed", level: "high" },
    ];
    for (const event of events) {
      expect(isContextInsightRefreshEvent(event)).toBe(false);
    }
  });
});
