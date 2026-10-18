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
import type { LoginPhase } from "@/lib/shared/channels-login";

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

/**
 * The live channel status: identity, workspace and the worker heartbeat. The
 * detail page owns this (re-read every 5s while mounted) — it is volatile, so
 * caching it in the store would only add a second, possibly stale copy.
 */
export interface ChannelStatusDetail {
  configured: boolean;
  accountId: string | null;
  userId: string | null;
  status: string;
  currentWorkspaceId: string | null;
  currentSessionId: string | null;
  workspaceAvailable: boolean | null;
  monitorRunning: boolean;
  health?: {
    alive: boolean;
    backingOff: boolean;
    consecutiveFailures: number;
    lastPollAt: string | null;
    lastFailureAt: string | null;
    nextRetryAt: string | null;
    retryInMs: number | null;
  };
}

export async function fetchChannelStatus(channelId: string): Promise<ChannelStatusDetail> {
  const res = await fetch(`/api/channels/${channelId}/wechat/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ChannelStatusDetail;
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

// ── WeChat scan login ───────────────────────────────────────────────────

export interface WechatLoginInfo {
  sessionKey: string;
  qrDataUrl: string;
  qrUrl: string;
  expiresAt: number;
}

/** Start (or restart) a QR login session for the channel. */
export async function startWechatLogin(channelId: string): Promise<WechatLoginInfo> {
  const res = await fetch(`/api/channels/${channelId}/wechat/login`, { method: "POST" });
  if (!res.ok) throw new Error(await errorCode(res));
  return (await res.json()) as WechatLoginInfo;
}

/** One poll of a login session's phase; `expired` maps the route's 410. */
export type WechatLoginStatus =
  | { kind: "phase"; phase: LoginPhase; message?: string }
  | { kind: "expired" };

export async function fetchWechatLoginStatus(
  channelId: string,
  sessionKey: string,
): Promise<WechatLoginStatus> {
  const res = await fetch(
    `/api/channels/${channelId}/wechat/login?sessionKey=${encodeURIComponent(sessionKey)}`,
    { cache: "no-store" },
  );
  if (res.status === 410) return { kind: "expired" };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { phase: LoginPhase; message?: string };
  return { kind: "phase", phase: data.phase, message: data.message };
}

/** Submit the pairing code WeChat shows after a scan. */
export async function submitWechatLoginCode(
  channelId: string,
  sessionKey: string,
  code: string,
): Promise<void> {
  const res = await fetch(`/api/channels/${channelId}/wechat/login/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey, code }),
  });
  if (!res.ok) throw new Error(await errorCode(res));
}
