/**
 * In-memory WeChat QR-login sessions.
 *
 * One session per active QR scan, keyed by a random `sessionKey` and bound
 * to a channel via `channelId`. Sessions are intentionally in-memory only:
 * if the server restarts mid-scan the user simply re-scans (matches the
 * original single-account behaviour). Nothing here touches the filesystem.
 */
import { randomUUID } from "crypto";
import type { LoginSession } from "../../shared/wechat/types";

const sessions = new Map<string, LoginSession>();
const SESSION_TTL_MS = 6 * 60 * 1000;

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (now - s.startedAt > SESSION_TTL_MS) sessions.delete(key);
  }
}

/** Start a new login session for a specific channel. */
export function createSession(initial: Omit<LoginSession, "sessionKey" | "startedAt" | "phase">): LoginSession {
  purgeExpired();
  const session: LoginSession = {
    ...initial,
    sessionKey: randomUUID(),
    startedAt: Date.now(),
    phase: "waiting",
  };
  sessions.set(session.sessionKey, session);
  return session;
}

export function getSession(sessionKey: string): LoginSession | null {
  const session = sessions.get(sessionKey);
  if (!session) return null;
  if (Date.now() - session.startedAt > SESSION_TTL_MS) {
    sessions.delete(sessionKey);
    return null;
  }
  return session;
}

export function updateSession(sessionKey: string, patch: Partial<LoginSession>): LoginSession | null {
  const session = getSession(sessionKey);
  if (!session) return null;
  const merged = { ...session, ...patch };
  sessions.set(sessionKey, merged);
  return merged;
}

export function dropSession(sessionKey: string): void {
  sessions.delete(sessionKey);
}

/** Drop every login session bound to a channel (start-of-scan cleanup). */
export function dropSessionsForChannel(channelId: string): void {
  for (const [key, session] of sessions) {
    if (session.channelId === channelId) sessions.delete(key);
  }
}
