import type { SessionInfo } from "./types";

export function selectLatestAssistantSession(
  sessions: readonly SessionInfo[],
): SessionInfo | null {
  let latest: SessionInfo | null = null;
  for (const session of sessions) {
    if (session.assistant !== true) continue;
    if (!latest || session.modified > latest.modified) latest = session;
  }
  return latest;
}

export function selectAssistantRestoreSession(
  initialSessionId: string | null,
  sessions: readonly SessionInfo[],
): SessionInfo | null {
  if (initialSessionId) return null;
  return selectLatestAssistantSession(sessions);
}
