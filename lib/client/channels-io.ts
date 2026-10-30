"use client";

import type { ChannelActivity, ChannelRecord } from "@/lib/shared/channels/types";
import type { LoginPhase } from "@/lib/shared/channels-login";

export async function fetchChannels(): Promise<ChannelRecord[]> {
  const res = await fetch("/api/channels?provider=wechat", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { channels?: ChannelRecord[] };
  return data.channels ?? [];
}

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

export async function deleteChannel(channelId: string): Promise<void> {
  const res = await fetch(`/api/channels/${channelId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorCode(res));
}

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

export async function fetchRecentCwds(limit = 30): Promise<string[]> {
  const res = await fetch(`/api/sessions?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { recentCwds?: string[] };
  return data.recentCwds ?? [];
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${res.status}`;
}

export interface WechatLoginInfo {
  sessionKey: string;
  qrDataUrl: string;
  qrUrl: string;
  expiresAt: number;
}

export async function startWechatLogin(channelId: string): Promise<WechatLoginInfo> {
  const res = await fetch(`/api/channels/${channelId}/wechat/login`, { method: "POST" });
  if (!res.ok) throw new Error(await errorCode(res));
  return (await res.json()) as WechatLoginInfo;
}

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
