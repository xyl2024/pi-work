import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startRpcSession: vi.fn(),
}));

vi.mock("@/lib/server/rpc-manager", () => ({
  startRpcSession: mocks.startRpcSession,
}));

import { POST } from "@/app/api/agent/new/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startRpcSession.mockResolvedValue({
    session: { send: vi.fn().mockResolvedValue({ ok: true }) },
    realSessionId: "session-1",
  });
});

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/agent/new", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent/new assistant flag", () => {
  it("starts a new assistant session with the assistant runtime options", async () => {
    const response = await POST(request({
      cwd: process.cwd(),
      type: "prompt",
      message: "你好",
      assistant: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.startRpcSession).toHaveBeenCalledTimes(1);
    const args = mocks.startRpcSession.mock.calls[0];
    expect(args.slice(0, 5)).toEqual([
      expect.stringMatching(/^__new__/),
      "",
      process.cwd(),
      undefined,
      "user",
    ]);
    expect(args[5]).toEqual({ assistant: true });
  });

  it("keeps ordinary new sessions unmarked", async () => {
    await POST(request({ cwd: process.cwd(), type: "prompt", message: "hi" }));

    expect(mocks.startRpcSession.mock.calls[0][5]).toEqual({});
  });
});
