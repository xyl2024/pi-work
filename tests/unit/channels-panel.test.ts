import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  fetchChannels: vi.fn(async () => []),
  createChannel: vi.fn(),
  deleteChannel: vi.fn(async () => {}),
  patchChannel: vi.fn(),
  switchChannelWorkspace: vi.fn(async () => {}),
  fetchWechatLoginStatus: vi.fn(async () => ({ kind: "phase", phase: "waiting" })),
  startWechatLogin: vi.fn(async () => ({
    sessionKey: "session-1",
    qrDataUrl: "data:image/png;base64,",
    qrUrl: "https://example.test/qr",
    expiresAt: 0,
  })),
  submitWechatLoginCode: vi.fn(async () => {}),
}));

vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

vi.mock("@/lib/client/channels-io", () => io);

import {
  channelsPanel,
  clearChannelSelection,
  createChannelInStore,
  openChannelDetail,
  openChannelForm,
  setChannelsNameDraft,
  setChannelWorkspaceDraft,
} from "@/lib/client/channels-panel";

async function openStore(): Promise<void> {
  channelsPanel.open();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  channelsPanel.release();
  vi.clearAllMocks();
  await openStore();
});

describe("channels page stack", () => {
  it("stays on browse when a channel is selected", () => {
    openChannelDetail("ch1");

    expect(channelsPanel.pages().map((page) => page.kind)).toEqual(["browse"]);
    expect(channelsPanel.get().selectedChannelId).toBe("ch1");
  });

  it("replaces the selection in place when another channel is picked", () => {
    openChannelDetail("ch1");
    openChannelDetail("ch2");

    expect(channelsPanel.pages().map((page) => page.kind)).toEqual(["browse"]);
    expect(channelsPanel.get().selectedChannelId).toBe("ch2");
  });

  it("adds the create form as the only second page", () => {
    openChannelForm();

    expect(channelsPanel.pages().map((page) => page.kind)).toEqual(["browse", "form"]);
    expect(channelsPanel.currentPage()).toEqual({ kind: "form" });
  });

  it("clears the selection for the narrow container's back gesture", () => {
    openChannelDetail("ch1");
    clearChannelSelection();

    expect(channelsPanel.get().selectedChannelId).toBeNull();
  });
});

describe("channels create form", () => {
  it("creates from the form draft and returns to browse with the new channel selected", async () => {
    io.createChannel.mockResolvedValue({
      id: "ch-new",
      name: "Team",
      provider: "wechat",
      status: "pending",
      workspaceId: null,
      currentSessionId: null,
      syncBuf: "",
      accountId: null,
      userId: null,
      createdAt: "",
      updatedAt: "",
    });

    openChannelForm();
    setChannelsNameDraft("Team");
    setChannelWorkspaceDraft("/work/team");
    const result = await createChannelInStore();

    expect(result.ok).toBe(true);
    expect(io.createChannel).toHaveBeenCalledWith("Team");
    expect(io.switchChannelWorkspace).toHaveBeenCalledWith("ch-new", "/work/team");
    expect(channelsPanel.pages().map((page) => page.kind)).toEqual(["browse"]);
    expect(channelsPanel.get().selectedChannelId).toBe("ch-new");
    expect(channelsPanel.get().nameDraft).toBe("");
  });
});
