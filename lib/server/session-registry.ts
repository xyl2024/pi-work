import type { AgentSessionWrapper } from "./rpc-manager";

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
}

export function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function listRunningRpcSessions(): { id: string; running: boolean }[] {
  const out: { id: string; running: boolean }[] = [];
  for (const [id, wrapper] of getRegistry()) {
    out.push({ id, running: wrapper.isRunning() });
  }
  return out;
}