import { NextResponse } from "next/server";
import {
  deleteSession,
  readSessionDetails,
  renameSession,
} from "@/lib/server/sessions";
import { getRpcSession } from "@/lib/server/rpc-manager";
import { openSessionForRuntime } from "@/lib/server/session-runtime-open";
import { resolveSessionPermission, sessionPermissionFields } from "@/lib/server/session-permission-visibility";
import { createLogger, elapsedMs } from "@/lib/server/logger";

const log = createLogger("api/sessions/[id]");

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const startedAt = Date.now();
  const url = new URL(req.url);
  const includeState = url.searchParams.has("includeState");
  log.debug("get session requested", { id, includeState });
  try {
    const session = await readSessionDetails(id);
    if (!session) {
      log.warn("get session not found", { id, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    let agentState: { running: boolean; state?: unknown } | undefined;
    if (includeState) {
      const rpc = getRpcSession(id);
      if (rpc?.isAlive()) {
        const state = await rpc.send({ type: "get_state" });
        agentState = { running: true, state };
      } else {
        try {
          const opened = await openSessionForRuntime(id);
          if (opened) {
            const state = await opened.send({ type: "get_state" });
            agentState = { running: true, state };
          } else {
            agentState = { running: false };
          }
        } catch (bootError) {
          log.warn("get session includeState failed to start rpc session", {
            id,
            error: String(bootError),
            durationMs: elapsedMs(startedAt),
          });
          agentState = { running: false };
        }
      }
    }

    log.info("get session completed", {
      id,
      filePath: session.filePath,
      messageCount: session.context.messages.length,
      includeState,
      agentRunning: agentState?.running,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({
      ...session,
      info: session.info
        ? { ...session.info, ...sessionPermissionFields(resolveSessionPermission(id)) }
        : session.info,
      ...(agentState !== undefined ? { agentState } : {}),
    });
  } catch (error) {
    log.error("get session failed", { id, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const startedAt = Date.now();
  log.debug("rename session requested", { id });
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      log.warn("rename session rejected", { id, reason: "missing name", durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const result = await renameSession(id, name);
    if (!result) {
      log.warn("rename session not found", { id, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    log.info("rename session completed", {
      id,
      filePath: result.filePath,
      nameLength: name.trim().length,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("rename session failed", { id, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  const startedAt = Date.now();
  log.debug("delete session requested", { id });
  try {
    const result = await deleteSession(id);
    if (!result) {
      log.warn("delete session not found", { id, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    log.info("delete session completed", {
      id,
      filePath: result.filePath,
      reparentedChildren: result.reparentedChildren,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("delete session failed", { id, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
