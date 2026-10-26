import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { startRpcSession } from "@/lib/server/rpc-manager";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { DEFAULT_PERMISSION_MODE, isPermissionMode } from "@/lib/shared/permission-mode";

const log = createLogger("api/agent/new");

// POST /api/agent/new  body: { cwd: string; type: string; message: string; ... }
// Spawns a brand-new pi session and immediately sends the first command.
// Returns { sessionId, data } where sessionId is pi's real session id.
export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;
    const commandType = typeof command.type === "string" ? command.type : "unknown";
    log.info("new agent session requested", {
      cwd,
      commandType,
      provider: typeof command.provider === "string" ? command.provider : undefined,
      modelId: typeof command.modelId === "string" ? command.modelId : undefined,
      toolCount: command.toolNames === "all" ? "all" : Array.isArray(command.toolNames) ? command.toolNames.length : undefined,
      thinkingLevel: typeof command.thinkingLevel === "string" ? command.thinkingLevel : undefined,
      permissionMode: typeof command.permissionMode === "string" ? command.permissionMode : undefined,
    });

    if (!cwd || typeof cwd !== "string") {
      log.warn("new agent session rejected", { reason: "missing cwd", durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      log.warn("new agent session rejected", { cwd, reason: "cwd not found", durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }
    // The new-session screen may hand over the mode the human picked before
    // there was a session. Validate it here (same explicit enumeration as the
    // RPC: an unknown value is rejected, never coerced to full access —
    // ADR-0008) and before creating anything, so a bad payload creates nothing.
    if (body.permissionMode !== undefined && !isPermissionMode(body.permissionMode)) {
      log.warn("new agent session rejected", { cwd, reason: "unknown permission mode", durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: `Unknown permission mode: ${String(body.permissionMode)}` }, { status: 400 });
    }

    // Use a one-time key so startRpcSession's lock doesn't conflict with real session ids
    const { provider, modelId, toolNames, thinkingLevel, permissionMode, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[] | "all"; thinkingLevel?: string; permissionMode?: unknown; [key: string]: unknown };

    const tempKey = `__new__${Date.now()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files. Without this,
    // a file request under a brand-new cwd would 403 for up to the cache TTL.
    globalThis.__piAllowedRootsCache?.roots.add(cwd);

    // Apply pre-selected model before sending the prompt
    if (provider && modelId) {
      await session.send({ type: "set_model", provider, modelId });
    }

    // Apply pre-selected thinking level before sending the prompt
    if (thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: thinkingLevel });
    }

    // Apply the mode picked on the new-session screen before the prompt, so the
    // very first dangerous command already sees it. `confirm` is the default a
    // session with no sidecar reads as, so writing it would only create a file
    // that says nothing.
    if (isPermissionMode(permissionMode) && permissionMode !== DEFAULT_PERMISSION_MODE) {
      await session.send({ type: "set_permission_mode", mode: permissionMode });
    }

    const result = await session.send(promptCommand);

    log.info("new agent session completed", {
      cwd,
      sessionId: realSessionId,
      commandType,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ success: true, sessionId: realSessionId, data: result });
  } catch (error) {
    log.error("new agent session failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
