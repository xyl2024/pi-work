import { describe, expect, it } from "vitest";

import {
  ASSISTANT_SESSION_ENTRY_TYPE,
  buildAssistantSessionMarkerData,
  isAssistantSessionMarkerData,
} from "@/lib/shared/assistant-marker";

describe("assistant session marker", () => {
  it("uses a custom entry type that stays out of model context", () => {
    expect(ASSISTANT_SESSION_ENTRY_TYPE).toBe("pi_work_assistant_session");
  });

  it("builds a versioned marker without a predecessor by default", () => {
    const marker = buildAssistantSessionMarkerData();

    expect(marker).toEqual({ version: 1 });
    expect(isAssistantSessionMarkerData(marker)).toBe(true);
  });

  it("reserves a predecessor session id for future handoff", () => {
    const marker = buildAssistantSessionMarkerData("session-before");

    expect(marker).toEqual({ version: 1, predecessorSessionId: "session-before" });
    expect(isAssistantSessionMarkerData(marker)).toBe(true);
  });

  it("rejects markers with an unknown shape", () => {
    expect(isAssistantSessionMarkerData(undefined)).toBe(false);
    expect(isAssistantSessionMarkerData({})).toBe(false);
    expect(isAssistantSessionMarkerData({ version: 2 })).toBe(false);
    expect(isAssistantSessionMarkerData({ version: 1, predecessorSessionId: 2 })).toBe(false);
  });
});
