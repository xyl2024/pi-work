"use client";

import { useSyncExternalStore } from "react";
import type { OAuthLoginState } from "@/lib/shared/models-config";
import {
  OAUTH_LOGIN_IDLE,
  anyOAuthLoginInProgress,
  isOAuthLoginWorking,
  oauthLoginToken,
  parseOAuthLoginEvent,
  reduceOAuthLogin,
  type OAuthLoginEvent,
} from "./oauth-login";

export type OAuthLoginSuccessHandler = () => void;

interface OAuthLoginSession {
  state: OAuthLoginState;
  eventSource: EventSource | null;
  onSuccess: OAuthLoginSuccessHandler | null;
}

const sessions = new Map<string, OAuthLoginSession>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function getOrCreateSession(providerId: string): OAuthLoginSession {
  let session = sessions.get(providerId);
  if (!session) {
    session = { state: OAUTH_LOGIN_IDLE, eventSource: null, onSuccess: null };
    sessions.set(providerId, session);
  }
  return session;
}

function applyEvent(providerId: string, event: OAuthLoginEvent): void {
  const session = getOrCreateSession(providerId);
  const transition = reduceOAuthLogin(session.state, event);
  if (transition.closeStream && session.eventSource) {
    session.eventSource.close();
    session.eventSource = null;
  }
  session.state = transition.state;
  emit();
  if (transition.openUrl) window.open(transition.openUrl, "_blank", "noopener,noreferrer");
  if (transition.succeeded) session.onSuccess?.();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshotFor(providerId: string): OAuthLoginState {
  return sessions.get(providerId)?.state ?? OAUTH_LOGIN_IDLE;
}

export function getOAuthLoginState(providerId: string): OAuthLoginState {
  return snapshotFor(providerId);
}

export function subscribeOAuthLogins(listener: () => void): () => void {
  return subscribe(listener);
}

export function useOAuthLoginState(providerId: string): OAuthLoginState {
  return useSyncExternalStore(
    subscribe,
    () => snapshotFor(providerId),
    () => OAUTH_LOGIN_IDLE,
  );
}

export function bindOAuthLoginSuccess(providerId: string, onSuccess: OAuthLoginSuccessHandler): void {
  getOrCreateSession(providerId).onSuccess = onSuccess;
}

export function startOAuthLogin(providerId: string): void {
  const session = getOrCreateSession(providerId);
  if (session.eventSource) return;

  applyEvent(providerId, { type: "start" });

  const eventSource = new EventSource(`/api/auth/login/${encodeURIComponent(providerId)}`);
  session.eventSource = eventSource;
  eventSource.onmessage = (message) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.data);
    } catch {
      return;
    }
    const event = parseOAuthLoginEvent(parsed);
    if (event) applyEvent(providerId, event);
  };
  eventSource.onerror = () => applyEvent(providerId, { type: "stream_error" });
}

export function cancelOAuthLogin(providerId: string): void {
  applyEvent(providerId, { type: "reset" });
}

export function hasActiveOAuthLogin(): boolean {
  return anyOAuthLoginInProgress([...sessions.values()].map((session) => session.state));
}

export function cancelActiveOAuthLogins(): void {
  for (const [providerId, session] of sessions) {
    if (isOAuthLoginWorking(session.state)) cancelOAuthLogin(providerId);
  }
}

export function resetSettledOAuthLogin(providerId: string): void {
  const session = sessions.get(providerId);
  if (session && !isOAuthLoginWorking(session.state)) applyEvent(providerId, { type: "reset" });
}

export async function submitOAuthLoginCode(
  providerId: string,
  value: string,
  progressMessage: string,
): Promise<boolean> {
  const token = oauthLoginToken(snapshotFor(providerId));
  if (!token) return false;
  const code = value.trim();
  if (!code) return false;

  applyEvent(providerId, { type: "progress", message: progressMessage });
  try {
    const res = await fetch(`/api/auth/login/${encodeURIComponent(providerId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, code }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      applyEvent(providerId, { type: "error", message: data.error ?? `Server error ${res.status}` });
      return false;
    }
    return true;
  } catch (e) {
    applyEvent(providerId, { type: "error", message: e instanceof Error ? e.message : "Network error" });
    return false;
  }
}

export async function logoutOAuthProvider(providerId: string): Promise<void> {
  await fetch(`/api/auth/logout/${encodeURIComponent(providerId)}`, { method: "POST" });
  applyEvent(providerId, { type: "reset" });
}
