"use client";

/**
 * Module-scoped holder for the channels *panel view*.
 *
 * The panel card only renders the active tab's body, so switching panel tabs
 * unmounts the view. Everything the user would notice losing therefore has to
 * live outside that mount: the channel list already read, the selected channel,
 * the page-stack position, the half-typed new-channel name, and — once the scan
 * login is wired (ticket #141) — the live login phase / QR code / pairing-code
 * input. That last one is the whole reason this module exists: scanning a QR
 * code, glancing at a session, and coming back must not lose the code.
 *
 * The rules stay pure and live in `lib/shared/channels-pages.ts` (page stack)
 * and `lib/shared/channels-close.ts` (the login phase the close guard reads).
 * This file is only the wiring — requests, the `useSyncExternalStore`
 * subscription, the first-open read, and the write-through actions.
 *
 * The channel list is live data (status changes underneath us), so closing the
 * tab drops it and the next open reads it again; there is no draft to preserve
 * except the create input. Deleting a channel draws the stack back to the list.
 */

import { useSyncExternalStore } from "react";
import { isContentEqual } from "./shallowEqual";
import { createChannel, deleteChannel, fetchChannels, patchChannel, switchChannelWorkspace } from "./channels-io";
import {
  backChannelsPage,
  channelsPagesAfterCreate,
  channelsPagesAfterDelete,
  createChannelsPageStack,
  currentChannelsPage,
  isChannelsRootPage,
  openChannelsPage,
  type ChannelsPage,
} from "@/lib/shared/channels-pages";
import type { ChannelRecord } from "@/lib/shared/channels/types";

export interface ChannelsStoreState {
  /** A channel-list read is in flight. */
  loading: boolean;
  /** A channel-list read has completed (the list is real). */
  loaded: boolean;
  /** The last read failed; the list shows this with a retry affordance. */
  loadError: string | null;
  channels: ChannelRecord[];
  /** The channel whose detail page is open, if any (used to highlight the list). */
  selectedChannelId: string | null;
  /** The panel's page stack: root → detail. */
  pages: ChannelsPage[];
  /** The new-channel input's in-progress name; survives a tab switch. */
  nameDraft: string;
  /** True while a create / rename / delete / workspace write is in flight. */
  busy: boolean;
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
};

let state: ChannelsStoreState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Content-equality guarded write — a no-op patch never re-renders. */
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

// ── Loading ─────────────────────────────────────────────────────────────

async function load(): Promise<void> {
  patch({ loading: true, loadError: null });
  try {
    const channels = await fetchChannels();
    patch({ loading: false, loaded: true, channels });
  } catch (e) {
    patch({ loading: false, loaded: false, loadError: errorMessage(e) });
  }
}

/**
 * Make sure the list is loaded. Reuse covers in-flight and failed reads: the
 * panel can unmount and remount on a tab switch without flashing a loading
 * state or auto-retrying an error the user has not acknowledged. Closing the
 * tab releases the store, so the next open reads again.
 */
export function ensureChannelsLoaded(): void {
  if (state.loaded || state.loading || state.loadError !== null) return;
  void load();
}

/** Force a fresh read — the list's retry affordance and post-write refresh. */
export function reloadChannels(): void {
  void load();
}

/**
 * Drop everything. Called by the shell when the channels tab closes: the tab is
 * the lifetime of the cache, so the next open lands back on the list and reads
 * the live statuses instead of resurrecting a stale list.
 */
export function releaseChannelsState(): void {
  if (state === INITIAL) return;
  state = INITIAL;
  emit();
}

// ── Create input ────────────────────────────────────────────────────────

export function setChannelsNameDraft(nameDraft: string): void {
  patch({ nameDraft });
}

/**
 * Create a channel from the root page's input and land on its detail page —
 * the next step is always to scan the QR code. Resolves `{ ok: false, error }`
 * so the caller can surface the failure through the toast.
 */
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

// ── Writes on one channel (write-through, no draft) ─────────────────────

/** Rename a channel and update the cached list in place. */
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

/** Enable / disable a channel (immediate, no save bar). */
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

/** Bind a channel to a working directory, then refresh the list. */
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

/** Delete a channel and converge the page stack back to the list. */
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

// ── Navigation ──────────────────────────────────────────────────────────

/** Open one channel's detail page (replacing a sibling detail page). */
export function openChannelDetail(channelId: string): void {
  patch({
    pages: openChannelsPage({ kind: "detail", channelId }),
    selectedChannelId: channelId,
  });
}

/** Pop one level; the channel list is the floor. */
export function channelsBack(): void {
  patch({ pages: backChannelsPage(state.pages) });
}

/**
 * Run Escape against the page stack: pop one level, or — when the list is
 * already on top — report that the panel tab is free to run its close rules.
 */
export function escapeChannels(): { closePanel: boolean } {
  if (isChannelsRootPage(state.pages)) return { closePanel: true };
  channelsBack();
  return { closePanel: false };
}

/** The channel whose detail page is open, if the stack is on one. */
export function currentChannel(state: ChannelsStoreState): ChannelRecord | null {
  const page = currentChannelsPage(state.pages);
  if (page.kind !== "detail") return null;
  return state.channels.find((channel) => channel.id === page.channelId) ?? null;
}
