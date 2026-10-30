"use client";

import { useSyncExternalStore } from "react";
import { isContentEqual } from "./shallowEqual";
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
import {
  backChannelsPage,
  channelsPagesAfterCreate,
  channelsPagesAfterDelete,
  createChannelsPageStack,
  isChannelsRootPage,
  openChannelsPage,
  type ChannelsPage,
} from "@/lib/shared/channels-pages";
import type { ChannelRecord } from "@/lib/shared/channels/types";
import { isLoginInProgress, type LoginPhase } from "@/lib/shared/channels-login";

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

export interface ChannelsStoreState {
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  channels: ChannelRecord[];
  selectedChannelId: string | null;
  pages: ChannelsPage[];
  nameDraft: string;
  busy: boolean;
  login: ChannelsLoginState;
}

const INITIAL: ChannelsStoreState = {
  loading: false,
  loaded: false,
  loadError: null,
  channels: [],
  selectedChannelId: null,
  pages: createChannelsPageStack(),
  nameDraft: "",
  busy: false,
  login: IDLE_LOGIN,
};

let state: ChannelsStoreState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function patch(partial: Partial<ChannelsStoreState>): void {
  let changed = false;
  for (const key of Object.keys(partial) as (keyof ChannelsStoreState)[]) {
    if (!isContentEqual(partial[key], state[key])) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...partial };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ChannelsStoreState {
  return state;
}

function getServerSnapshot(): ChannelsStoreState {
  return INITIAL;
}

export function useChannelsStore(): ChannelsStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function load(): Promise<void> {
  patch({ loading: true, loadError: null });
  try {
    const channels = await fetchChannels();
    patch({ loading: false, loaded: true, channels });
  } catch (e) {
    patch({ loading: false, loaded: false, loadError: errorMessage(e) });
  }
}

export function ensureChannelsLoaded(): void {
  if (state.loaded || state.loading || state.loadError !== null) return;
  void load();
}

export function reloadChannels(): void {
  void load();
}

export function releaseChannelsState(): void {
  if (state === INITIAL) return;
  stopLoginPoll();
  loginGeneration += 1;
  state = INITIAL;
  emit();
}

let loginPollTimer: ReturnType<typeof setTimeout> | null = null;
let loginGeneration = 0;

function stopLoginPoll(): void {
  if (loginPollTimer) {
    clearTimeout(loginPollTimer);
    loginPollTimer = null;
  }
}

async function pollLogin(): Promise<void> {
  const { channelId, sessionKey } = state.login;
  if (!channelId || !sessionKey) return;
  const generation = loginGeneration;
  let phase = state.login.phase;
  try {
    const result = await fetchWechatLoginStatus(channelId, sessionKey);
    if (generation !== loginGeneration) return;
    if (result.kind === "expired") {
      patch({ login: { ...state.login, phase: "expired", phaseMessage: "channels.sessionExpired" } });
      return;
    }
    phase = result.phase;
    patch({ login: { ...state.login, phase, phaseMessage: result.message ?? null } });
    if (phase === "confirmed") {
      reloadChannels();
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
  patch({ login: { ...IDLE_LOGIN, channelId, phase: "waiting", busy: true } });
  try {
    const info = await startWechatLogin(channelId);
    if (generation !== loginGeneration) return { ok: false };
    patch({
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
    if (generation === loginGeneration) patch({ login: IDLE_LOGIN });
    return { ok: false, error: errorMessage(e) };
  }
}

export function setLoginCode(code: string): void {
  if (state.login.channelId === null) return;
  patch({ login: { ...state.login, code } });
}

export async function submitLoginCode(): Promise<{ ok: boolean; error?: string }> {
  const { channelId, sessionKey, code } = state.login;
  if (!channelId || !sessionKey || !code.trim()) return { ok: false };
  patch({ login: { ...state.login, busy: true } });
  try {
    await submitWechatLoginCode(channelId, sessionKey, code.trim());
    patch({ login: { ...state.login, code: "", busy: false } });
    return { ok: true };
  } catch (e) {
    patch({ login: { ...state.login, busy: false } });
    return { ok: false, error: errorMessage(e) };
  }
}

export function refreshLoginQr(channelId: string): void {
  void startLogin(channelId);
}

export function stopLogin(): void {
  stopLoginPoll();
  loginGeneration += 1;
  patch({ login: IDLE_LOGIN });
}

export function getLoginPhase(): LoginPhase | null {
  return state.login.phase;
}

export function setChannelsNameDraft(nameDraft: string): void {
  patch({ nameDraft });
}

export async function createChannelInStore(): Promise<{ ok: boolean; error?: string }> {
  const name = state.nameDraft.trim();
  if (!name) return { ok: false, error: "name_required" };
  if (state.busy) return { ok: false };
  patch({ busy: true });
  try {
    const channel = await createChannel(name);
    patch({
      channels: [channel, ...state.channels],
      selectedChannelId: channel.id,
      pages: channelsPagesAfterCreate(channel.id),
      nameDraft: "",
      busy: false,
    });
    return { ok: true };
  } catch (e) {
    patch({ busy: false });
    return { ok: false, error: errorMessage(e) };
  }
}

export async function renameChannel(
  channelId: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "invalid_name" };
  if (state.busy) return { ok: false };
  patch({ busy: true });
  try {
    const channel = await patchChannel(channelId, { name: trimmed });
    patch({ channels: replaceChannel(state.channels, channel), busy: false });
    return { ok: true };
  } catch (e) {
    patch({ busy: false });
    return { ok: false, error: errorMessage(e) };
  }
}

export async function toggleChannelEnabled(
  channelId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (state.busy) return { ok: false };
  patch({ busy: true });
  try {
    const channel = await patchChannel(channelId, { status: enabled ? "connected" : "disabled" });
    patch({ channels: replaceChannel(state.channels, channel), busy: false });
    return { ok: true };
  } catch (e) {
    patch({ busy: false });
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setChannelWorkspace(
  channelId: string,
  workspaceId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await switchChannelWorkspace(channelId, workspaceId);
    reloadChannels();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function removeChannel(channelId: string): Promise<{ ok: boolean; error?: string }> {
  if (state.busy) return { ok: false };
  patch({ busy: true });
  try {
    await deleteChannel(channelId);
    patch({
      channels: state.channels.filter((channel) => channel.id !== channelId),
      selectedChannelId: null,
      pages: channelsPagesAfterDelete(),
      busy: false,
    });
    return { ok: true };
  } catch (e) {
    patch({ busy: false });
    return { ok: false, error: errorMessage(e) };
  }
}

function replaceChannel(channels: ChannelRecord[], next: ChannelRecord): ChannelRecord[] {
  return channels.map((channel) => (channel.id === next.id ? next : channel));
}

export function openChannelDetail(channelId: string): void {
  patch({
    pages: openChannelsPage({ kind: "detail", channelId }),
    selectedChannelId: channelId,
  });
}

export function channelsBack(): void {
  patch({ pages: backChannelsPage(state.pages) });
}

export function escapeChannels(): { closePanel: boolean } {
  if (isChannelsRootPage(state.pages)) return { closePanel: true };
  channelsBack();
  return { closePanel: false };
}
