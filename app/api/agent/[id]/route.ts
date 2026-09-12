import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/server/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/server/rpc-manager";
import { resumeTaskForSession } from "@/lib/server/kanban/store";
import { markRunEnd } from "@/lib/server/kanban/store";
import { attachSessionSyncWatcher } from "@/lib/server/kanban/session-sync";
import type { AgentSessionWrapper } from "@/lib/server/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createLogger, elapsedMs } from "@/lib/server/logger";

const log = createLogger("api/agent/[id]");

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const startedAt = Date.now();

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };
    const commandType = typeof body.type === "string" ? body.type : "unknown";
    log.info("agent command requested", { id, commandType });

    // Resolve the wrapper that will process this command: reuse a live one, or
    // cold-start from the session file when it isn't in memory yet.
    let sendWrapper: AgentSessionWrapper | null = null;
    let sessionSource = "existing";
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      sendWrapper = existing;
    } else {
      const filePath = await resolveSessionPath(id);
      if (!filePath) {
        log.warn("agent command session not found", { id, commandType, durationMs: elapsedMs(startedAt) });
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
      const { session } = await startRpcSession(id, filePath, cwd);
      sendWrapper = session;
      sessionSource = "started";
    }

    // Kanban reverse-sync: revive the card ONLY now that we know we can send a
    // prompt — a missing session file above already returned 404 before this.
    const resumedTask =
      commandType === "prompt" ? resumeTaskForSession(id) : null;

    // Attach the watcher BEFORE sending so the very first agent_end of the
    // continued conversation is captured even if the agent finishes quickly.
    if (resumedTask) {
      attachSessionSyncWatcher(sendWrapper, id, resumedTask.id);
    }

    try {
      const result = await sendWrapper.send(body);
      log.info("agent command completed", {
        id,
        commandType,
        sessionSource,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ success: true, data: result });
    } catch (error) {
      // A failed send shouldn't leave an orphaned `in_progress` card: the
      // resume already flipped it, so put it back to review_test with the
      // failure recorded instead of leaving a zombie in_progress row.
      if (resumedTask) {
        markRunEnd(resumedTask.id, {
          status: "review_test",
          resultSummary: null,
          error: `resume failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 2000)}`,
        });
      }
      throw error;
    }
  } catch (error) {
    log.error("agent command failed", { id, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
//
// Lazy-boots the RPC session when it isn't alive yet (mirrors the events
// endpoint). Without this, a freshly-started server that loads an existing
// session reports { running: false } with no `state`, so the client never
// learns the session's systemPrompt and panels like BTW stay stuck on
// "main session initializing…" until the user clicks their refresh button.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const startedAt = Date.now();
  log.debug("agent state requested", { id });

  try {
    let session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      const filePath = await resolveSessionPath(id);
      if (!filePath) {
        log.debug("agent state completed: session not found", { id, durationMs: elapsedMs(startedAt) });
        return NextResponse.json({ running: false });
      }
      const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
      try {
        ({ session } = await startRpcSession(id, filePath, cwd));
        log.debug("agent state started session", { id, durationMs: elapsedMs(startedAt) });
      } catch (startError) {
        // Boot failed — degrade to the old calm response instead of 500
        // so read-only consumers (readiness gates, refresh buttons) can
        // retry later once the wrapper is alive.
        log.warn("agent state failed to start session", { id, error: String(startError), durationMs: elapsedMs(startedAt) });
        return NextResponse.json({ running: false });
      }
    }

    const state = await session!.send({ type: "get_state" });
    log.debug("agent state completed", { id, running: true, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    log.error("agent state failed", { id, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
