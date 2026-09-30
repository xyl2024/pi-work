import { NextResponse } from "next/server";
import { getRpcSession, listRunningRpcSessions } from "@/lib/server/session-registry";
import { dataPath } from "@/lib/server/data-dir";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { buildTemplateVariableValues, type TemplateVariableValues } from "@/lib/shared/system-prompt-template";
import { emptyTemplateMaterial } from "@/lib/server/system-prompt-template-source";

export const dynamic = "force-dynamic";

const log = createLogger("api/system-prompt-template");

/**
 * `GET /api/system-prompt-template[?sessionId=…]`
 *
 * The settings preview needs the *variable bodies* the current session would
 * render with. They are collected here (the impure half) and rendered on the
 * client with the same pure module the server uses, so "preview" and "what the
 * session sends" cannot drift.
 *
 * Fallbacks, in order: an explicitly named live session → the most recently
 * registered live session → no session at all (real docs paths and date, empty
 * session-derived variables). A template can therefore be built before any
 * session exists.
 */
export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const requestedId = new URL(req.url).searchParams.get("sessionId");
    const session = requestedId ? getRpcSession(requestedId) : mostRecentRunningSession();
    // The preview composes the cwd section too (pi appends it unconditionally),
    // so the route reports which cwd the variables were collected against.
    const cwd = session?.cwd ?? dataPath("workspace", "pi-cwd-default");
    const variables: TemplateVariableValues =
      session?.templateVariables() ?? buildTemplateVariableValues(emptyTemplateMaterial(cwd));
    log.info("template variables read", {
      sessionId: session?.sessionId ?? null,
      requestedId: requestedId ?? null,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ sessionId: session?.sessionId ?? null, cwd, variables });
  } catch (error) {
    log.error("template variables read failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** Registry insertion order is start order, so the last entry is the newest. */
function mostRecentRunningSession() {
  const sessions = listRunningRpcSessions();
  const newest = sessions[sessions.length - 1];
  return newest ? (getRpcSession(newest.id) ?? null) : null;
}
