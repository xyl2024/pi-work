import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  runTurnRpcSession: vi.fn(),
  getChannel: vi.fn(),
  updateChannel: vi.fn(),
  pushActivity: vi.fn(),
  loadChannelAccount: vi.fn(),
  claimMessage: vi.fn(),
  buildMessageKey: vi.fn(() => "message-key"),
  abandonMessage: vi.fn(),
  markProcessed: vi.fn(),
  isPathAllowed: vi.fn(() => true),
  getAllowedRoots: vi.fn(async () => [] as string[]),
  sendTyping: vi.fn(async () => {}),
  sendTextMessage: vi.fn(async () => {}),
  newClientId: vi.fn(() => "client-1"),
  logSessionEvent: vi.fn(),
}));

vi.mock("@/lib/server/rpc-manager", () => ({ runTurnRpcSession: mocks.runTurnRpcSession }));
vi.mock("@/lib/server/channels", () => ({
  getChannel: mocks.getChannel,
  updateChannel: mocks.updateChannel,
}));
vi.mock("@/lib/server/channels/activity", () => ({ pushActivity: mocks.pushActivity }));
vi.mock("@/lib/server/channels/credentials", () => ({ loadChannelAccount: mocks.loadChannelAccount }));
vi.mock("@/lib/server/channels/messages", () => ({
  buildMessageKey: mocks.buildMessageKey,
  claimMessage: mocks.claimMessage,
  abandonMessage: mocks.abandonMessage,
  markProcessed: mocks.markProcessed,
}));
vi.mock("@/lib/server/file-access", () => ({
  isPathAllowed: mocks.isPathAllowed,
  getAllowedRoots: mocks.getAllowedRoots,
}));
vi.mock("@/lib/server/wechat", () => ({
  api: {
    sendTyping: mocks.sendTyping,
    sendTextMessage: mocks.sendTextMessage,
    newClientId: mocks.newClientId,
  },
}));
vi.mock("@/lib/server/wechat/sessions-log", () => ({ logSessionEvent: mocks.logSessionEvent }));

import { handleInbound } from "@/lib/server/wechat/inbound";

let dir: string;
const originalLogFile = process.env.PI_WORK_LOG_FILE;

beforeAll(() => {
  process.env.PI_WORK_LOG_FILE = "off";
  dir = mkdtempSync(join(tmpdir(), "pi-work-wechat-purpose-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalLogFile === undefined) delete process.env.PI_WORK_LOG_FILE;
  else process.env.PI_WORK_LOG_FILE = originalLogFile;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getChannel.mockReturnValue({
    id: "ch-1",
    provider: "wechat",
    status: "connected",
    workspaceId: dir,
    currentSessionId: null,
    name: "测试频道",
  });
  mocks.loadChannelAccount.mockReturnValue({ baseUrl: "http://localhost", token: "token" });
  mocks.claimMessage.mockReturnValue("accepted");
  mocks.runTurnRpcSession.mockResolvedValue({
    status: "completed",
    text: "channel reply",
    hasReply: true,
    error: null,
    stopReason: null,
    sessionId: "turn-key",
    realSessionId: "real-session",
  });
});

describe("wechat inbound call attribution", () => {
  it("runs a cold-start turn with user source and channel purpose", async () => {
    await handleInbound({ channelId: "ch-1", fromUserId: "u-1", text: "hello" });

    expect(mocks.runTurnRpcSession).toHaveBeenCalledTimes(1);
    const spec = mocks.runTurnRpcSession.mock.calls[0][0];
    expect(spec).toMatchObject({
      cwd: dir,
      prompt: "hello",
      source: "user",
      purpose: "channel",
      session: { kind: "fresh" },
      toolNames: "all",
      origin: { kind: "channel", channelId: "ch-1", provider: "wechat", name: "测试频道" },
    });
    expect(spec.prompt).toBe("hello");
    expect(mocks.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "channel reply", to: "u-1" }),
    );
  });

  it("keeps user source and channel purpose when continuing the channel's session", async () => {
    mocks.getChannel.mockReturnValue({
      id: "ch-1",
      provider: "wechat",
      status: "connected",
      workspaceId: dir,
      currentSessionId: "existing-session",
      name: "测试频道",
    });

    await handleInbound({ channelId: "ch-1", fromUserId: "u-1", text: "follow up" });

    const spec = mocks.runTurnRpcSession.mock.calls[0][0];
    expect(spec).toMatchObject({
      source: "user",
      purpose: "channel",
      session: { kind: "reuse", sessionId: "existing-session" },
      origin: { kind: "channel", channelId: "ch-1", provider: "wechat", name: "测试频道" },
    });
    expect(spec.toolNames).toBeUndefined();
  });
});
