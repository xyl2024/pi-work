"use client";

/**
 * Module-scoped OAuth login holder for the models-config surface.
 *
 * The detail view is a consumer: it renders the current phase and calls the
 * actions here. The `EventSource` and the phase state live *outside* its
 * lifecycle, keyed by provider id, so switching providers (or unmounting for
 * any other reason) does not drop an authorization that is still running — the
 * view remounts and re-attaches to the same session. Starting a login for a
 * provider that already has a live stream is a re-attach, not a second
 * `EventSource`.
 *
 * ADR-0003 rule 1 gives a concern a module-level store when its state must
 * outlive a single mount; that is the whole reason this exists. The rules the
 * store runs are pure and live in `lib/client/oauth-login.ts`; this file is the
 * wiring (stream, requests, `window.open`, the success callback), which ADR-0003
 * rule 3 leaves to the manual checklist.
 */

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

/** Runs once when a login reaches `success` (refresh the provider list, toast). */
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

/** The live phase for one provider. Survives the consumer unmounting. */
export function useOAuthLoginState(providerId: string): OAuthLoginState {
  return useSyncExternalStore(
    subscribe,
    () => snapshotFor(providerId),
    () => OAUTH_LOGIN_IDLE,
  );
}

/**
 * Point the running success callback at the mounted view. Call it from an
 * effect: a view that remounts while a login is still in flight takes over the
 * refresh/toast the stream would otherwise deliver to the previous mount.
 */
export function bindOAuthLoginSuccess(providerId: string, onSuccess: OAuthLoginSuccessHandler): void {
  getOrCreateSession(providerId).onSuccess = onSuccess;
}

/** Start a login for a provider that has no live stream. */
export function startOAuthLogin(providerId: string): void {
  const session = getOrCreateSession(providerId);
  if (session.eventSource) return; // Already running — never a second stream.

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

/** Close the stream (if any) and return the phase to idle. */
export function cancelOAuthLogin(providerId: string): void {
  applyEvent(providerId, { type: "reset" });
}

/**
 * Whether any provider still has a login running. The models-config panel's
 * close guard reads this: closing the tab while an authorization is in flight
 * is the one case that asks first.
 */
export function hasActiveOAuthLogin(): boolean {
  return anyOAuthLoginInProgress([...sessions.values()].map((session) => session.state));
}

/**
 * Drop every running login. Called when the user confirms closing the panel
 * tab mid-authorization — that confirmation is only honest if the session
 * really ends here instead of continuing invisibly behind a closed tab.
 */
export function cancelActiveOAuthLogins(): void {
  for (const [providerId, session] of sessions) {
    if (isOAuthLoginWorking(session.state)) cancelOAuthLogin(providerId);
  }
}

/**
 * Drop a finished session (idle / success / error) so a view that opens later
 * starts from idle again. A login that is still running is left alone — that is
 * the whole point of the store. Call it when a view mounts on a provider.
 */
export function resetSettledOAuthLogin(providerId: string): void {
  const session = sessions.get(providerId);
  if (session && !isOAuthLoginWorking(session.state)) applyEvent(providerId, { type: "reset" });
}

/**
 * Send the pasted redirect URL / code for a pending `auth` or `prompt` phase.
 * Resolves true when the server accepted it, so the caller can clear its input.
 */
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

/** Disconnect the provider and clear the session phase. */
export async function logoutOAuthProvider(providerId: string): Promise<void> {
  await fetch(`/api/auth/logout/${encodeURIComponent(providerId)}`, { method: "POST" });
  applyEvent(providerId, { type: "reset" });
}
