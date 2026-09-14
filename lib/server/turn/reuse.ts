/**
 * The "reuse an existing session" branch of turn session acquisition.
 *
 * A reuse turn must run in the session the caller named — never open a new one
 * behind its back. Three cases, in this order:
 *   1. the session is still running → hand it over as-is;
 *   2. its process is gone but the session file is on disk → reopen the file
 *      and continue there;
 *   3. there is no session file → fail loudly (`Session not found: <id>`), so
 *      the caller can tell "the session is gone" from "start a new one".
 *
 * This module imports no runtime dependency: the live registry, the disk
 * lookup, the cwd read and the reopen are injected, so all three cases are
 * unit-tested with fakes. Production wiring lives in `./rpc-factory`.
 */
import type { AcquiredTurnSession, TurnSession } from "./orchestrate";

/** Everything `acquireReusedSession` needs from the outside world. */
export interface ReusedSessionSource {
  /**
   * The live wrapper serving `sessionId`, or undefined when none does.
   * Implementations must filter out destroyed wrappers: a returned session is,
   * by contract, alive and usable.
   */
  getLiveSession(sessionId: string): TurnSession | undefined;

  /** The session's file on disk, or null when the session does not exist. */
  findSessionFile(sessionId: string): Promise<string | null>;

  /** The working directory recorded in a session file (the cwd to reopen in). */
  readSessionCwd(sessionFile: string): string;

  /** Reopen the session file as a live wrapper addressed by `sessionId`. */
  reopenSession(sessionId: string, sessionFile: string, cwd: string): Promise<AcquiredTurnSession>;
}

/**
 * Acquire the session a reuse turn must run in. Never creates a new session:
 * a missing session file is an error, not a silent fresh start.
 */
export async function acquireReusedSession(
  sessionId: string,
  source: ReusedSessionSource,
): Promise<AcquiredTurnSession> {
  const live = source.getLiveSession(sessionId);
  if (live) {
    // A live session is already the session the caller named: use it as-is.
    return { session: live, sessionId, realSessionId: sessionId };
  }

  const sessionFile = await source.findSessionFile(sessionId);
  if (!sessionFile) {
    // Deliberately not a fresh session: the caller asked to continue a specific
    // conversation, and silently starting another one would reply in the wrong
    // place. The wording matches the pre-seam wechat path.
    throw new Error(`Session not found: ${sessionId}`);
  }

  const cwd = source.readSessionCwd(sessionFile);
  return await source.reopenSession(sessionId, sessionFile, cwd);
}
