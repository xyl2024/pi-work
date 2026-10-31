import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/server/rpc-manager";
import { openSessionForRuntime } from "@/lib/server/session-runtime-open";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import {
  findSubagentSessionOwner,
  stopSubagentTaskForChildSession,
  submitSubagentManualPrompt,
  SubagentManualInputError,
} from "@/lib/server/subagent-manual-input";

const log = createLogger("api/agent/[id]");

const MANUAL_ERROR_STATUS: Record<SubagentManualInputError["code"], number> = {
  "not-subagent": 404,
  busy: 409,
  stopping: 409,
  unavailable: 409,
  invalid: 400,
};

function handleSubagentChildCommand(
  id: string,
  body: { type: string; [key: string]: unknown },
): Response | null {
  if (body.type !== "prompt" && body.type !== "abort") return null;
  const owner = findSubagentSessionOwner(id);
  if (!owner) return null;

  if (body.type === "abort") {
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

    const manual = handleSubagentChildCommand(id, body);
    if (manual) {
      log.info("agent command handled as subagent task", {
        id,
        commandType,
        durationMs: elapsedMs(startedAt),
      });
      return manual;
    }

    const existing = getRpcSession(id);
    const sessionSource = existing?.isAlive() ? "existing" : "started";
    const sendWrapper = existing?.isAlive() ? existing : await openSessionForRuntime(id);
    if (!sendWrapper) {
      log.warn("agent command session not found", { id, commandType, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
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
      try {
        session = (await openSessionForRuntime(id)) ?? undefined;
        if (!session) {
          log.debug("agent state completed: session not found", { id, durationMs: elapsedMs(startedAt) });
          return NextResponse.json({ running: false });
        }
        log.debug("agent state started session", { id, durationMs: elapsedMs(startedAt) });
      } catch (startError) {
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
