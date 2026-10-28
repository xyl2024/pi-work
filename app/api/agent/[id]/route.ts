import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/server/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/server/rpc-manager";
import type { AgentSessionWrapper } from "@/lib/server/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import {
  findSubagentSessionOwner,
  stopSubagentTaskForChildSession,
  submitSubagentManualPrompt,
  SubagentManualInputError,
} from "@/lib/server/subagent-manual-input";
import { openSubagentChildSession } from "@/lib/server/subagent-tasks";

const log = createLogger("api/agent/[id]");

/** HTTP status for one manual-input refusal. */
const MANUAL_ERROR_STATUS: Record<SubagentManualInputError["code"], number> = {
  "not-subagent": 404,
  busy: 409,
  stopping: 409,
  unavailable: 409,
  invalid: 400,
};

/**
 * A child session's own chat input and stop button are the same kind of work as
 * the parent agent's `subagent` action: they go through the task manager, never
 * through a raw prompt/abort on the session. Anything else about the child
 * session (state reads, tool changes, an explicit permission-mode switch) keeps
 * the normal path — the child stays a subagent but remains inspectable.
 */
function handleSubagentChildCommand(
  id: string,
  body: { type: string; [key: string]: unknown },
): Response | null {
  if (body.type !== "prompt" && body.type !== "abort") return null;
  const owner = findSubagentSessionOwner(id);
  if (!owner) return null;

  if (body.type === "abort") {
    // Stop the task this session is running, not a raw abort: the task stays
    // `stopping` until the turn confirms, and a later task is never touched.
    // With nothing tracked there is nothing for the manager to stop, so the
    // command falls through to the session (a compaction, for example).
    const stopped = stopSubagentTaskForChildSession(id);
    if (!stopped) return null;
    return NextResponse.json({ success: true, data: { stopped: true, ...stopped } });
  }

  const submitted = submitSubagentManualPrompt({
    childSessionId: id,
    message: typeof body.message === "string" ? body.message : "",
    requestId: typeof body.request_id === "string" ? body.request_id : null,
    hasImages: Array.isArray(body.images) && body.images.length > 0,
  });
  return NextResponse.json({ success: true, data: submitted });
}

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

    // Before touching a wrapper: a known child session's input and stop belong
    // to the task manager (one unfinished task per child, the global queue,
    // dedupe and the parent's stop-all all apply).
    const manual = handleSubagentChildCommand(id, body);
    if (manual) {
      log.info("agent command handled as subagent task", {
        id,
        commandType,
        durationMs: elapsedMs(startedAt),
      });
      return manual;
    }

    // Resolve the wrapper that will process this command: reuse a live one, or
    // cold-start from the session file when it isn't in memory yet.
    let sendWrapper: AgentSessionWrapper | null = null;
    let sessionSource = "existing";
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      sendWrapper = existing;
    } else {
      // A child session reopens with the configuration frozen when it was
      // created and keeps its subagent identity (no subagent tool, no ordinary
      // user session); anything else follows the ordinary start path.
      const childSession = await openSubagentChildSession(id);
      if (childSession) {
        sendWrapper = childSession;
        sessionSource = "started-subagent";
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
    }

    const result = await sendWrapper.send(body);
    log.info("agent command completed", {
      id,
      commandType,
      sessionSource,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof SubagentManualInputError) {
      log.info("agent command refused for subagent session", {
        id,
        code: error.code,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ error: error.message }, { status: MANUAL_ERROR_STATUS[error.code] });
    }
    log.error("agent command failed", { id, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
//
// Lazy-boots the RPC session when it isn't alive yet (mirrors the events
// endpoint). Without this, a freshly-started server that loads an existing
// session reports { running: false } with no `state`, so the client never
// learns the session's systemPrompt and the Context panel stays stuck on
// "main session initializing…" until it is fetched again.
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
        session = await openSubagentChildSession(id)
          ?? (await startRpcSession(id, filePath, cwd)).session;
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
