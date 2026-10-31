import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRpcSession: vi.fn(),
  startRpcSession: vi.fn(),
  resolveSessionPath: vi.fn(),
  openSubagentChildSession: vi.fn(),
  resolveSessionPermission: vi.fn(),
  openSessionFile: vi.fn(),
}));

vi.mock("@/lib/server/rpc-manager", () => ({
  getRpcSession: mocks.getRpcSession,
  startRpcSession: mocks.startRpcSession,
}));

vi.mock("@/lib/server/session-reader", () => ({
  resolveSessionPath: mocks.resolveSessionPath,
}));

vi.mock("@/lib/server/subagent-tasks", () => ({
  openSubagentChildSession: mocks.openSubagentChildSession,
}));

vi.mock("@/lib/server/session-permission-visibility", () => ({
  resolveSessionPermission: mocks.resolveSessionPermission,
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: { open: mocks.openSessionFile },
}));

import { openSessionForRuntime } from "@/lib/server/session-runtime-open";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRpcSession.mockReturnValue(null);
  mocks.openSubagentChildSession.mockResolvedValue(null);
  mocks.resolveSessionPath.mockResolvedValue("/sessions/child.jsonl");
  mocks.openSessionFile.mockReturnValue({ getHeader: () => ({ cwd: "/work" }) });
  mocks.resolveSessionPermission.mockReturnValue({ permissionMode: "confirm", background: false });
  mocks.startRpcSession.mockResolvedValue({ session: { source: "user" } });
});

describe("opening a session for runtime", () => {
  it("returns a live session without reopening anything", async () => {
    const live = { isAlive: () => true, source: "user" };
    mocks.getRpcSession.mockReturnValue(live);

    await expect(openSessionForRuntime("live")).resolves.toBe(live);
    expect(mocks.openSubagentChildSession).not.toHaveBeenCalled();
    expect(mocks.startRpcSession).not.toHaveBeenCalled();
  });

  it("reopens a subagent child before resolving a generic session file", async () => {
    const child = { isAlive: () => true, source: "subagent" };
    mocks.openSubagentChildSession.mockResolvedValue(child);

    await expect(openSessionForRuntime("child")).resolves.toBe(child);
    expect(mocks.resolveSessionPath).not.toHaveBeenCalled();
    expect(mocks.startRpcSession).not.toHaveBeenCalled();
  });

  it("starts a background session with its recorded tier", async () => {
    const started = { source: "scheduled" };
    mocks.resolveSessionPermission.mockReturnValue({
      permissionMode: "full_access",
      background: true,
    });
    mocks.startRpcSession.mockResolvedValue({ session: started });

    await expect(openSessionForRuntime("scheduled")).resolves.toBe(started);
    expect(mocks.startRpcSession).toHaveBeenCalledWith(
      "scheduled",
      "/sessions/child.jsonl",
      "/work",
      undefined,
      "scheduled",
      { permissionMode: "full_access" },
    );
  });

  it("starts a foreground session without a background tier", async () => {
    await openSessionForRuntime("foreground");
    expect(mocks.startRpcSession).toHaveBeenCalledWith(
      "foreground",
      "/sessions/child.jsonl",
      "/work",
      undefined,
      "user",
      {},
    );
  });

  it("returns null when no session file exists", async () => {
    mocks.resolveSessionPath.mockResolvedValue(null);
    await expect(openSessionForRuntime("missing")).resolves.toBeNull();
    expect(mocks.startRpcSession).not.toHaveBeenCalled();
  });
});
