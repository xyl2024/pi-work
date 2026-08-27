/**
 * In-process registry of live `AgentSessionWrapper`s.
 *
 * Owns `globalThis.__piSessions` so both `rpc-manager.ts` (which creates and
 * registers wrappers) and server-only custom tools (e.g.
 * `lib/server/self-tools/session-tools.ts`) can read the set of currently
 * alive sessions WITHOUT introducing an import cycle back into rpc-manager.
 *
 * The class itself stays in rpc-manager.ts; this module only references it as
 * a type (erased at build time), never as a runtime import.
 */

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

/** The live wrapper for a session, or undefined if it isn't loaded in memory. */
export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

/**
 * Snapshot of which registered sessions exist and whether each is running.
 * Reads `globalThis.__piSessions` only — no disk I/O — so callers can poll
 * this cheaply (the SessionSidebar uses it every 3s to render a spinner on
 * the active row). A wrapper present here is alive; entries are removed when
 * the wrapper is destroyed.
 */
export function listRunningRpcSessions(): { id: string; running: boolean }[] {
  const out: { id: string; running: boolean }[] = [];
  for (const [id, wrapper] of getRegistry()) {
    out.push({ id, running: wrapper.isRunning() });
  }
  return out;
}