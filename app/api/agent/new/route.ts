import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { startRpcSession } from "@/lib/server/rpc-manager";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { DEFAULT_PERMISSION_MODE, isPermissionMode } from "@/lib/shared/permission-mode";

const log = createLogger("api/agent/new");

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
    if (body.permissionMode !== undefined && !isPermissionMode(body.permissionMode)) {
      log.warn("new agent session rejected", { cwd, reason: "unknown permission mode", durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: `Unknown permission mode: ${String(body.permissionMode)}` }, { status: 400 });
    }

    const { provider, modelId, toolNames, thinkingLevel, permissionMode, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[] | "all"; thinkingLevel?: string; permissionMode?: unknown; [key: string]: unknown };

    const tempKey = `__new__${Date.now()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);

    globalThis.__piAllowedRootsCache?.roots.add(cwd);

    if (provider && modelId) {
      await session.send({ type: "set_model", provider, modelId });
    }

    if (thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: thinkingLevel });
    }

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
