import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession, startRpcSession } from "./rpc-manager";
import { resolveSessionPath } from "./session-reader";
import { openSubagentChildSession } from "./subagent-tasks";
import { resolveSessionPermission } from "./session-permission-visibility";
import { createLogger } from "./logger";
import type { AgentSessionWrapper } from "./rpc-manager";

const log = createLogger("session-runtime-open");

export async function openSessionForRuntime(
  sessionId: string,
): Promise<AgentSessionWrapper | null> {
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) return live;

  const child = await openSubagentChildSession(sessionId);
  if (child) {
    log.info("reopened subagent session", { sessionId });
    return child;
  }

  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;
  const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
  const permission = resolveSessionPermission(sessionId);
  const { session } = await startRpcSession(
    sessionId,
    filePath,
    cwd,
    undefined,
    permission.background ? "scheduled" : "user",
    permission.background ? { permissionMode: permission.permissionMode } : {},
  );
  log.info("started session", {
    sessionId,
    cwd,
    background: permission.background,
    permissionMode: permission.permissionMode,
  });
  return session;
}
