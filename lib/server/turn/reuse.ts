import type { AcquiredTurnSession, TurnSession } from "./orchestrate";

export interface ReusedSessionSource {
  getLiveSession(sessionId: string): TurnSession | undefined;

  findSessionFile(sessionId: string): Promise<string | null>;

  readSessionCwd(sessionFile: string): string;

  reopenSession(sessionId: string, sessionFile: string, cwd: string): Promise<AcquiredTurnSession>;
}

export async function acquireReusedSession(
  sessionId: string,
  source: ReusedSessionSource,
): Promise<AcquiredTurnSession> {
  const live = source.getLiveSession(sessionId);
  if (live) {
    return { session: live, sessionId, realSessionId: sessionId };
  }

  const sessionFile = await source.findSessionFile(sessionId);
  if (!sessionFile) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const cwd = source.readSessionCwd(sessionFile);
  return await source.reopenSession(sessionId, sessionFile, cwd);
}
