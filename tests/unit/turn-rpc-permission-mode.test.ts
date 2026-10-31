import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunTurnSpec } from "@/lib/server/turn";

const mocks = vi.hoisted(() => ({
  runTurn: vi.fn(),
  startRpcSession: vi.fn(),
  getRpcSession: vi.fn(),
}));

vi.mock("@/lib/server/turn/orchestrate", () => ({
  runTurn: mocks.runTurn,
}));

vi.mock("@/lib/server/rpc-manager", () => ({
  startRpcSession: mocks.startRpcSession,
  getRpcSession: mocks.getRpcSession,
}));

import { runTurnRpcSession } from "@/lib/server/turn/rpc-factory";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startRpcSession.mockResolvedValue({
    session: { sessionId: "real-1" },
    realSessionId: "real-1",
  });
  mocks.runTurn.mockImplementation(
    async (
      spec: RunTurnSpec,
      factory: (
        cwd: string,
        toolNames: RunTurnSpec["toolNames"],
        source: string,
        policy: { kind: "fresh" },
        permissionMode?: RunTurnSpec["permissionMode"],
      ) => Promise<{ sessionId: string; realSessionId: string }>,
    ) => {
      const acquired = await factory(
        spec.cwd,
        spec.toolNames,
        spec.source ?? "user",
        { kind: "fresh" },
        spec.permissionMode,
      );
      return {
        status: "completed",
        text: "done",
        hasReply: true,
        error: null,
        stopReason: "end_turn",
        sessionId: acquired.sessionId,
        realSessionId: acquired.realSessionId,
      };
    },
  );
});

describe("turn session start options", () => {
  it.each(["auto_deny", "full_access"] as const)(
    "forwards the %s mode to startRpcSession",
    async (permissionMode) => {
      await runTurnRpcSession({
        cwd: "/tmp/project",
        prompt: "go",
        source: "scheduled",
        permissionMode,
        timeoutMs: 1000,
      });

      expect(mocks.startRpcSession).toHaveBeenCalledTimes(1);
      const args = mocks.startRpcSession.mock.calls[0];
      expect(args[2]).toBe("/tmp/project");
      expect(args[4]).toBe("scheduled");
      expect(args[5]).toEqual({ permissionMode });
    },
  );

  it("leaves start options untouched when no mode is supplied", async () => {
    await runTurnRpcSession({
      cwd: "/tmp/project",
      prompt: "go",
      source: "scheduled",
      timeoutMs: 1000,
    });

    expect(mocks.startRpcSession.mock.calls[0][5]).toEqual({});
  });
});
