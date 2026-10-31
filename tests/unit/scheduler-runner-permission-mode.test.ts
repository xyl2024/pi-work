import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTask } from "@/lib/server/scheduler/store";

const mocks = vi.hoisted(() => ({
  runTurnRpcSession: vi.fn(),
  recordRunEnd: vi.fn(),
}));

vi.mock("@/lib/server/rpc-manager", () => ({
  runTurnRpcSession: mocks.runTurnRpcSession,
}));

vi.mock("@/lib/server/scheduler/store", () => ({
  recordRunEnd: mocks.recordRunEnd,
}));

import { runTask } from "@/lib/server/scheduler/runner";

function task(permissionMode: ScheduledTask["permissionMode"]): ScheduledTask {
  return {
    id: "task-1",
    name: "Nightly",
    cron: "0 9 * * *",
    cwd: process.cwd(),
    prompt: "rebuild the cache",
    enabled: true,
    provider: null,
    modelId: null,
    thinkingLevel: null,
    toolNames: null,
    permissionMode,
    maxLifetimeMs: null,
    timezone: "UTC",
    notification: null,
    createdAt: 1,
    updatedAt: 1,
    lastRunAt: null,
    nextRunAt: null,
    lastRunStatus: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runTurnRpcSession.mockResolvedValue({
    status: "completed",
    text: "done",
    hasReply: true,
    error: null,
    stopReason: "end_turn",
    sessionId: "turn-key",
    realSessionId: "real-1",
  });
});

describe("scheduled run permission mode", () => {
  it.each(["auto_deny", "full_access"] as const)(
    "passes the task's %s mode into the turn session start",
    async (mode) => {
      await runTask(task(mode), "run-1");

      expect(mocks.runTurnRpcSession).toHaveBeenCalledTimes(1);
      expect(mocks.runTurnRpcSession.mock.calls[0][0]).toMatchObject({
        cwd: process.cwd(),
        prompt: "rebuild the cache",
        source: "scheduled",
        toolNames: "all",
        permissionMode: mode,
      });
    },
  );
});
