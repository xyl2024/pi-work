"use client";

import {
  createPanelViewStore,
  type PanelViewAdapter,
  type PanelViewStore,
  type PanelViewWriter,
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
import { isChannelsLeaveGuarded } from "@/lib/shared/channels-close";
import { isLoginInProgress, type LoginPhase } from "@/lib/shared/channels-login";
import { registerMainViewLeaveGuard } from "./main-view-leave";
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
  workspaceDraft: string | null;
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
  workspaceDraft: null,
  busy: false,
  login: IDLE_LOGIN,
};

const BROWSE_PAGE: ChannelsPage = { kind: "browse" };
const LOGIN_POLL_MS = 2000;

let loginPollWriter: PanelViewWriter<ChannelsViewState, ChannelsPage> | null = null;
let loginPollTimer: ReturnType<typeof setTimeout> | null = null;
let loginGeneration = 0;

function stopLoginPoll(): void {
  if (loginPollTimer !== null) {
    clearTimeout(loginPollTimer);
    loginPollTimer = null;
  }
}

function stopChannelsRuntime(): void {
  stopLoginPoll();
  loginGeneration += 1;
  loginPollWriter = null;
}

function scheduleLoginPoll(): void {
  if (loginPollTimer !== null) return;
  const writer = loginPollWriter;
  if (!writer) return;
  if (!isLoginInProgress(writer.get().login.phase)) return;
  loginPollTimer = setTimeout(() => {
    loginPollTimer = null;
    void pollLogin();
  }, LOGIN_POLL_MS);
}

async function pollLogin(): Promise<void> {
  const writer = loginPollWriter;
  if (!writer) return;
  const { channelId, sessionKey } = writer.get().login;
  if (!channelId || !sessionKey) return;
  const generation = loginGeneration;
  try {
    const result = await fetchWechatLoginStatus(channelId, sessionKey);
    if (generation !== loginGeneration || loginPollWriter !== writer) return;
    if (result.kind === "expired") {
      writer.patch({
        login: {
          ...writer.get().login,
          phase: "expired",
          phaseMessage: "channels.sessionExpired",
        },
      });
      return;
    }
    writer.patch({
      login: { ...writer.get().login, phase: result.phase, phaseMessage: result.message ?? null },
    });
    if (result.phase === "confirmed") {
      channelsPanel.reload();
      return;
    }
  } catch {
  }
  if (generation !== loginGeneration) return;
  scheduleLoginPoll();
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
    scheduleLoginPoll();
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

export function setChannelWorkspaceDraft(workspaceDraft: string | null): void {
  channelsPanel.patch({ workspaceDraft });
}

export function reloadChannels(): void {
  channelsPanel.reload();
}

export function openChannelDetail(channelId: string): void {
  channelsPanel.patch({ selectedChannelId: channelId });
}

export function clearChannelSelection(): void {
  channelsPanel.patch({ selectedChannelId: null });
}

export function openChannelForm(): void {
  channelsPanel.patch({ nameDraft: "", workspaceDraft: null });
  channelsPanel.openPage({ kind: "form" });
}

export function discardChannelForm(): void {
  channelsPanel.patch({ nameDraft: "", workspaceDraft: null });
  channelsPanel.back();
}

export async function createChannelInStore(): Promise<{ ok: boolean; error?: string }> {
  const scope = channelsPanel.scope();
  const { nameDraft, workspaceDraft } = scope.get();
  const name = nameDraft.trim();
  if (!name) return { ok: false, error: "name_required" };
  if (scope.get().busy) return { ok: false };
  scope.patch({ busy: true });
  try {
    const channel = await createChannel(name);
    if (workspaceDraft) await switchChannelWorkspace(channel.id, workspaceDraft);
    scope.patch({
      channels: [channel, ...scope.get().channels],
      selectedChannelId: channel.id,
      nameDraft: "",
      workspaceDraft: null,
      busy: false,
    });
    channelsPanel.resetPages();
    if (workspaceDraft) channelsPanel.reload();
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
  rootPage: BROWSE_PAGE,
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
  start(writer) {
    loginPollWriter = writer;
    scheduleLoginPoll();
  },
  stop: stopChannelsRuntime,
  release: stopChannelsRuntime,
  status(state) {
    return isLoginInProgress(state.login.phase);
  },
};

export const channelsPanel: PanelViewStore<ChannelsViewState, ChannelsPage, void> =
  createPanelViewStore(channelsAdapter);

registerMainViewLeaveGuard("channels", {
  dirty: () => isChannelsLeaveGuarded(channelsPanel.get().login.phase),
  discard: stopLogin,
});

export function useChannelsPanel() {
  return channelsPanel.useSnapshot();
}
