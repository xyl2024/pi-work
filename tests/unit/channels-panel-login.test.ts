import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { channelsPanel, startLogin, stopLogin } from "@/lib/client/channels-panel";
import {
  setMainViewLeaveConfirm,
  requestMainViewLeave,
} from "@/lib/client/main-view-leave";
import { MAIN_VIEW_LEAVE_CONFIRM } from "@/lib/shared/main-view-leave";
import type { LoginPhase } from "@/lib/shared/channels-login";
import { CHANNELS_GUARDED_PHASES } from "@/lib/shared/channels-close";

async function openStore(): Promise<void> {
  channelsPanel.open();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  vi.useFakeTimers();
  channelsPanel.release();
  vi.clearAllMocks();
  await openStore();
});

afterEach(() => {
  channelsPanel.release();
  vi.useRealTimers();
});

describe("channels login polling", () => {
  it("never spins while no login is in progress", async () => {
    await vi.advanceTimersByTimeAsync(20_000);

    expect(io.fetchWechatLoginStatus).not.toHaveBeenCalled();
  });

  it("polls every two seconds while the login is in progress", async () => {
    await startLogin("ch1");

    await vi.advanceTimersByTimeAsync(1_999);
    expect(io.fetchWechatLoginStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(io.fetchWechatLoginStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(io.fetchWechatLoginStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after the main view leaves the foreground", async () => {
    await startLogin("ch1");
    channelsPanel.setVisible(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(io.fetchWechatLoginStatus).toHaveBeenCalledTimes(2);
  });

  it("stops and reloads the channel list once the login completes", async () => {
    io.fetchWechatLoginStatus.mockResolvedValue({ kind: "phase", phase: "confirmed" });
    const reload = vi.spyOn(channelsPanel, "reload");

    await startLogin("ch1");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(reload).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(io.fetchWechatLoginStatus).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the store is released", async () => {
    await startLogin("ch1");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(io.fetchWechatLoginStatus).toHaveBeenCalledTimes(1);

    channelsPanel.release();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(io.fetchWechatLoginStatus).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the login is discarded", async () => {
    await startLogin("ch1");
    stopLogin();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(io.fetchWechatLoginStatus).not.toHaveBeenCalled();
  });
});

describe("channels login badge status", () => {
  it("reports only the phases that keep a login running", async () => {
    expect(channelsPanel.status()).toBe(false);

    await startLogin("ch1");
    expect(channelsPanel.status()).toBe(true);

    stopLogin();
    expect(channelsPanel.status()).toBe(false);
  });
});

const GUARDED: readonly LoginPhase[] = CHANNELS_GUARDED_PHASES;
const UNGUARDED: readonly LoginPhase[] = [
  "verify_blocked",
  "redirected",
  "confirmed",
  "already_bound",
  "expired",
  "error",
];

async function beginLogin(phase: LoginPhase): Promise<void> {
  await startLogin("ch1");
  channelsPanel.patch({ login: { ...channelsPanel.get().login, phase } });
}

describe("channels leave guard", () => {
  const confirm = vi.fn(async () => true);

  beforeEach(() => {
    setMainViewLeaveConfirm(confirm);
    confirm.mockClear();
  });

  afterEach(() => {
    setMainViewLeaveConfirm(null);
  });

  it("asks the one shared confirmation before returning to chat", async () => {
    await beginLogin("waiting");

    await expect(
      requestMainViewLeave({ view: "channels", intent: "leave_main_view" }),
    ).resolves.toBe(true);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(MAIN_VIEW_LEAVE_CONFIRM);
    expect(channelsPanel.get().login.phase).toBeNull();
  });

  it("asks the same single confirmation when switching to another main view", async () => {
    await beginLogin("scanned");

    await expect(
      requestMainViewLeave({ view: "channels", intent: "switch_main_view" }),
    ).resolves.toBe(true);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(MAIN_VIEW_LEAVE_CONFIRM);
  });

  it("keeps the login running when the confirmation is cancelled", async () => {
    confirm.mockResolvedValueOnce(false);
    await beginLogin("verifying");

    await expect(
      requestMainViewLeave({ view: "channels", intent: "leave_main_view" }),
    ).resolves.toBe(false);

    expect(channelsPanel.get().login.phase).toBe("verifying");
  });

  it("never asks when a secondary page goes back inside the view", async () => {
    await beginLogin("waiting");

    await expect(
      requestMainViewLeave({ view: "channels", intent: "back_to_browse" }),
    ).resolves.toBe(true);

    expect(confirm).not.toHaveBeenCalled();
    expect(channelsPanel.get().login.phase).toBe("waiting");
  });

  it("summons the prompt for exactly the three live scanning phases", async () => {
    for (const phase of GUARDED) {
      confirm.mockClear();
      await beginLogin(phase);

      await requestMainViewLeave({ view: "channels", intent: "leave_main_view" });

      expect(confirm, phase).toHaveBeenCalledTimes(1);
    }
  });

  it("lets every finished phase leave silently without killing its result", async () => {
    for (const phase of UNGUARDED) {
      confirm.mockClear();
      await beginLogin(phase);

      await expect(
        requestMainViewLeave({ view: "channels", intent: "leave_main_view" }),
      ).resolves.toBe(true);

      expect(confirm, phase).not.toHaveBeenCalled();
      expect(channelsPanel.get().login.phase, phase).toBe(phase);
    }
  });

  it("lets an idle view leave silently", async () => {
    await expect(
      requestMainViewLeave({ view: "channels", intent: "leave_main_view" }),
    ).resolves.toBe(true);

    expect(confirm).not.toHaveBeenCalled();
  });
});
