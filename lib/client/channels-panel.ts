"use client";

import {
  createPanelViewStore,
  type PanelViewAdapter,
  type PanelViewCloseGuard,
  type PanelViewStore,
} from "./panel-view-store";
import {
  createChannel,
  deleteChannel,
  fetchChannels,
  fetchWechatLoginStatus,
  patchChannel,
  startWechatLogin,
  submitWechatLoginCode,
  switchChannelWorkspace,
} from "./channels-io";
import { selectChannelsCloseConfirm } from "@/lib/shared/channels-close";
import { isLoginInProgress, type LoginPhase } from "@/lib/shared/channels-login";
import { errorMessage } from "@/lib/shared/error-message";
import type { ChannelRecord, ChannelsPage } from "@/lib/shared/channels/types";

export interface ChannelsLoginState {
  channelId: string | null;
  sessionKey: string | null;
  qrDataUrl: string | null;
  qrUrl: string | null;
  expiresAt: number | null;
  phase: LoginPhase | null;
  phaseMessage: string | null;
  code: string;
  busy: boolean;
}

const IDLE_LOGIN: ChannelsLoginState = {
  channelId: null,
  sessionKey: null,
  qrDataUrl: null,
  qrUrl: null,
  expiresAt: null,
  phase: null,
  phaseMessage: null,
  code: "",
  busy: false,
};

export interface ChannelsViewState {
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  channels: ChannelRecord[];
  selectedChannelId: string | null;
  nameDraft: string;
  busy: boolean;
  login: ChannelsLoginState;
}

const INITIAL: ChannelsViewState = {
  loading: false,
  loaded: false,
  loadError: null,
  channels: [],
  selectedChannelId: null,
  nameDraft: "",
  busy: false,
  login: IDLE_LOGIN,
};

const ROOT_PAGE: ChannelsPage = { kind: "root" };

let loginPollTimer: ReturnType<typeof setTimeout> | null = null;
let loginGeneration = 0;

function stopLoginPoll(): void {
  if (loginPollTimer) {
    clearTimeout(loginPollTimer);
    loginPollTimer = null;
  }
}

async function pollLogin(): Promise<void> {
  const scope = channelsPanel.scope();
  const { channelId, sessionKey } = scope.get().login;
  if (!channelId || !sessionKey) return;
  const generation = loginGeneration;
  let phase = scope.get().login.phase;
  try {
    const result = await fetchWechatLoginStatus(channelId, sessionKey);
    if (generation !== loginGeneration) return;
    if (result.kind === "expired") {
      const login = scope.get().login;
      scope.patch({ login: { ...login, phase: "expired", phaseMessage: "channels.sessionExpired" } });
      return;
    }
    phase = result.phase;
    scope.patch({ login: { ...scope.get().login, phase, phaseMessage: result.message ?? null } });
    if (phase === "confirmed") {
      channelsPanel.reload();
      return;
    }
  } catch {
  }
  if (generation !== loginGeneration) return;
  if (isLoginInProgress(phase)) {
    loginPollTimer = setTimeout(() => void pollLogin(), 2000);
  }
}

export async function startLogin(channelId: string): Promise<{ ok: boolean; error?: string }> {
  stopLoginPoll();
  const generation = ++loginGeneration;
  const scope = channelsPanel.scope();
  scope.patch({ login: { ...IDLE_LOGIN, channelId, phase: "waiting", busy: true } });
  try {
    const info = await startWechatLogin(channelId);
    if (generation !== loginGeneration) return { ok: false };
    scope.patch({
      login: {
        channelId,
        sessionKey: info.sessionKey,
        qrDataUrl: info.qrDataUrl,
        qrUrl: info.qrUrl,
        expiresAt: info.expiresAt,
        phase: "waiting",
        phaseMessage: null,
        code: "",
        busy: false,
      },
    });
    loginPollTimer = setTimeout(() => void pollLogin(), 2000);
    return { ok: true };
  } catch (e) {
    if (generation === loginGeneration) scope.patch({ login: IDLE_LOGIN });
    return { ok: false, error: errorMessage(e) };
  }
}

export function setLoginCode(code: string): void {
  const login = channelsPanel.get().login;
  if (login.channelId === null) return;
  channelsPanel.patch({ login: { ...login, code } });
}

export async function submitLoginCode(): Promise<{ ok: boolean; error?: string }> {
  const scope = channelsPanel.scope();
  const { channelId, sessionKey, code } = scope.get().login;
  if (!channelId || !sessionKey || !code.trim()) return { ok: false };
  scope.patch({ login: { ...scope.get().login, busy: true } });
  try {
    await submitWechatLoginCode(channelId, sessionKey, code.trim());
    scope.patch({ login: { ...scope.get().login, code: "", busy: false } });
    return { ok: true };
  } catch (e) {
    scope.patch({ login: { ...scope.get().login, busy: false } });
    return { ok: false, error: errorMessage(e) };
  }
}

export function refreshLoginQr(channelId: string): void {
  void startLogin(channelId);
}

export function stopLogin(): void {
  stopLoginPoll();
  loginGeneration += 1;
  channelsPanel.patch({ login: IDLE_LOGIN });
}

export function setChannelsNameDraft(nameDraft: string): void {
  channelsPanel.patch({ nameDraft });
}

export function reloadChannels(): void {
  channelsPanel.reload();
}

export function openChannelDetail(channelId: string): void {
  channelsPanel.openPage({ kind: "detail", channelId });
  channelsPanel.patch({ selectedChannelId: channelId });
}

export async function createChannelInStore(): Promise<{ ok: boolean; error?: string }> {
  const scope = channelsPanel.scope();
  const name = scope.get().nameDraft.trim();
  if (!name) return { ok: false, error: "name_required" };
  if (scope.get().busy) return { ok: false };
  scope.patch({ busy: true });
  try {
    const channel = await createChannel(name);
    scope.patch({
      channels: [channel, ...scope.get().channels],
      selectedChannelId: channel.id,
      nameDraft: "",
      busy: false,
    });
    channelsPanel.openPage({ kind: "detail", channelId: channel.id });
    return { ok: true };
  } catch (e) {
    scope.patch({ busy: false });
    return { ok: false, error: errorMessage(e) };
  }
}

export async function renameChannel(
  channelId: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const scope = channelsPanel.scope();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "invalid_name" };
  if (scope.get().busy) return { ok: false };
  scope.patch({ busy: true });
  try {
    const channel = await patchChannel(channelId, { name: trimmed });
    scope.patch({ channels: replaceChannel(scope.get().channels, channel), busy: false });
    return { ok: true };
  } catch (e) {
    scope.patch({ busy: false });
    return { ok: false, error: errorMessage(e) };
  }
}

export async function toggleChannelEnabled(
  channelId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const scope = channelsPanel.scope();
  if (scope.get().busy) return { ok: false };
  scope.patch({ busy: true });
  try {
    const channel = await patchChannel(channelId, { status: enabled ? "connected" : "disabled" });
    scope.patch({ channels: replaceChannel(scope.get().channels, channel), busy: false });
    return { ok: true };
  } catch (e) {
    scope.patch({ busy: false });
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setChannelWorkspace(
  channelId: string,
  workspaceId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await switchChannelWorkspace(channelId, workspaceId);
    channelsPanel.reload();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function removeChannel(channelId: string): Promise<{ ok: boolean; error?: string }> {
  const scope = channelsPanel.scope();
  if (scope.get().busy) return { ok: false };
  scope.patch({ busy: true });
  try {
    await deleteChannel(channelId);
    scope.patch({
      channels: scope.get().channels.filter((channel) => channel.id !== channelId),
      selectedChannelId: null,
      busy: false,
    });
    channelsPanel.resetPages();
    return { ok: true };
  } catch (e) {
    scope.patch({ busy: false });
    return { ok: false, error: errorMessage(e) };
  }
}

function replaceChannel(channels: ChannelRecord[], next: ChannelRecord): ChannelRecord[] {
  return channels.map((channel) => (channel.id === next.id ? next : channel));
}

const channelsAdapter: PanelViewAdapter<ChannelsViewState, ChannelsPage, void, string> = {
  kind: "channels",
  initial: INITIAL,
  rootPage: ROOT_PAGE,
  loadPolicy: "once",
  key: () => "channels",
  async load(_key, { patch, signal }) {
    patch({ loading: true, loadError: null });
    try {
      const channels = await fetchChannels(signal);
      patch({ loading: false, loaded: true, channels });
    } catch (e) {
      patch({ loading: false, loaded: false, loadError: errorMessage(e) });
    }
  },
  release() {
    stopLoginPoll();
    loginGeneration += 1;
  },
  guard(state): PanelViewCloseGuard | null {
    const confirm = selectChannelsCloseConfirm({ phase: state.login.phase });
    if (!confirm) return null;
    return { ...confirm, discard: stopLogin };
  },
  status(state) {
    return state.busy;
  },
  isSiblingPage(next, current) {
    return next.kind === "detail" && current.kind === "detail";
  },
};

export const channelsPanel: PanelViewStore<ChannelsViewState, ChannelsPage, void> =
  createPanelViewStore(channelsAdapter);

export function useChannelsPanel() {
  return channelsPanel.useSnapshot();
}
