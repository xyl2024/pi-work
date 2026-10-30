import { describe, expect, it } from "vitest";
import { acquireReusedSession, type ReusedSessionSource } from "@/lib/server/turn/reuse";
import type { AcquiredTurnSession, TurnSession } from "@/lib/server/turn";

class FakeTurnSession implements TurnSession {
  constructor(readonly sessionId: string) {}
  onEvent(): () => void {
    return () => {};
  }
  onDestroy(): () => void {
    return () => {};
  }
  async send(): Promise<unknown> {
    return null;
  }
  destroy(): void {}
}

interface Recorded {
  liveLookups: string[];
  fileLookups: string[];
  cwdReads: string[];
  reopens: Array<{ sessionId: string; sessionFile: string; cwd: string }>;
}

interface SourceOptions {
  live?: TurnSession;
  file?: string | null;
  cwd?: string;
  reopened?: AcquiredTurnSession;
}

function makeSource(options: SourceOptions = {}): { source: ReusedSessionSource; recorded: Recorded } {
  const recorded: Recorded = { liveLookups: [], fileLookups: [], cwdReads: [], reopens: [] };
  const source: ReusedSessionSource = {
    getLiveSession: (sessionId) => {
      recorded.liveLookups.push(sessionId);
      return options.live;
    },
    findSessionFile: async (sessionId) => {
      recorded.fileLookups.push(sessionId);
      return options.file ?? null;
    },
    readSessionCwd: (sessionFile) => {
      recorded.cwdReads.push(sessionFile);
      return options.cwd ?? "/tmp/project";
    },
    reopenSession: async (sessionId, sessionFile, cwd) => {
      recorded.reopens.push({ sessionId, sessionFile, cwd });
      return options.reopened ?? { session: new FakeTurnSession(sessionId), sessionId, realSessionId: sessionId };
    },
  };
  return { source, recorded };
}

describe("acquireReusedSession — continue the session the caller named", () => {
  it("uses the live session directly and does not look at disk when it is still running", async () => {
    const live = new FakeTurnSession("s-1");
    const { source, recorded } = makeSource({ live });

    const acquired = await acquireReusedSession("s-1", source);

    expect(acquired.session).toBe(live);
    expect(acquired.sessionId).toBe("s-1");
    expect(acquired.realSessionId).toBe("s-1");
    expect(recorded.fileLookups).toEqual([]);
    expect(recorded.reopens).toEqual([]);
  });

  it("revives the session from its file when the process is gone", async () => {
    const reopened: AcquiredTurnSession = {
      session: new FakeTurnSession("s-2"),
      sessionId: "s-2",
      realSessionId: "s-2",
    };
    const { source, recorded } = makeSource({
      file: "/sessions/s-2.jsonl",
      cwd: "/tmp/workspace",
      reopened,
    });

    const acquired = await acquireReusedSession("s-2", source);

    expect(acquired).toBe(reopened);
    expect(recorded.cwdReads).toEqual(["/sessions/s-2.jsonl"]);
    expect(recorded.reopens).toEqual([
      { sessionId: "s-2", sessionFile: "/sessions/s-2.jsonl", cwd: "/tmp/workspace" },
    ]);
  });

  it("fails loudly instead of silently starting a new session when no session file exists", async () => {
    const { source, recorded } = makeSource();

    await expect(acquireReusedSession("ghost", source)).rejects.toThrow("Session not found: ghost");
    expect(recorded.reopens).toEqual([]);
    expect(recorded.cwdReads).toEqual([]);
  });
});
