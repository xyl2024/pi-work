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

export function dropSessionsForChannel(channelId: string): void {
  for (const [key, session] of sessions) {
    if (session.channelId === channelId) sessions.delete(key);
  }
}
