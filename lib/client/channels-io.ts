"use client";

/**
 * Client-side request wrappers for the channels panel.
 *
 * Thin fetch helpers only — the store (`lib/client/channels-store.ts`) owns the
 * caching, the write-through rules and the module-level lifetime. These mirror
 * `lib/client/skills-io.ts` / `lib/client/scheduler-io.ts`: one function per
 * endpoint, errors thrown so the caller decides what to surface.
 */

import type { ChannelActivity, ChannelRecord } from "@/lib/shared/channels/types";

/** Read every WeChat channel. */
export async function fetchChannels(): Promise<ChannelRecord[]> {
  const res = await fetch("/api/channels?provider=wechat", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { channels?: ChannelRecord[] };
  return data.channels ?? [];
}

/** Create a WeChat channel with `name` and return the created record. */
export async function createChannel(name: string): Promise<ChannelRecord> {
  const res = await fetch("/api/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, provider: "wechat" }),
  });
  if (!res.ok) throw new Error(await errorCode(res));
  const data = (await res.json()) as { channel: ChannelRecord };
  return data.channel;
}

/** Rename a channel, or flip it between connected / disabled. */
export async function patchChannel(
  channelId: string,
  patch: { name?: string; status?: "connected" | "disabled" },
): Promise<ChannelRecord> {
  const res = await fetch(`/api/channels/${channelId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorCode(res));
  const data = (await res.json()) as { channel: ChannelRecord };
  return data.channel;
}

/** Delete a channel (stops its worker, clears credentials / cursor / messages). */
export async function deleteChannel(channelId: string): Promise<void> {
  const res = await fetch(`/api/channels/${channelId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorCode(res));
}

/** Bind the channel to a working directory (validated server-side). */
export async function switchChannelWorkspace(
  channelId: string,
  workspaceId: string,
): Promise<void> {
  const res = await fetch(`/api/channels/${channelId}/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  if (!res.ok) throw new Error(await errorCode(res));
}

/** Read a channel's activity feed — the newest `limit` events. */
export async function fetchChannelActivity(
  channelId: string,
  limit = 50,
): Promise<ChannelActivity[]> {
  const res = await fetch(`/api/channels/${channelId}/activity?limit=${limit}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { activity?: ChannelActivity[] };
  return data.activity ?? [];
}

/** Read the working directories the workspace picker offers. */
export async function fetchRecentCwds(limit = 30): Promise<string[]> {
  const res = await fetch(`/api/sessions?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { recentCwds?: string[] };
  return data.recentCwds ?? [];
}

/** Best-effort error code from a JSON error body. */
async function errorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${res.status}`;
}
