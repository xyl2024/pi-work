/**
 * Process-singleton MCP client manager.
 *
 * Responsibilities:
 *  - Maintain one `McpServerHandle` per enabled server, on demand.
 *  - Drive `connect / listTools / callTool` against the configured
 *    transport.
 *  - Apply timeouts + 5 min idle auto-disconnect.
 *  - Surface failures as `status: "error"` + `error` text rather than
 *    throwing across the REST boundary.
 *
 * Lives on `globalThis.__mcp` so Next.js hot-reload does not lose
 * handles (matches `lib/rpc-manager.ts`'s `__piSessions` pattern).
 *
 * Client handle can be safely reused across concurrent operations;
 * `connect()` itself is locked on `__mcpStartLocks` so two simultaneous
 * connects for the same name return the same promise.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createLogger, elapsedMs } from "../logger";
import { readMcpConfig } from "./config-store";
import {
  buildClient,
  buildTransport,
  MCP_CLIENT_VERSION,
} from "./transport";
import type {
  McpCallResult,
  McpConfig,
  McpContent,
  McpConnectionStatus,
  McpServerConfig,
  McpServerView,
  McpToolInfo,
} from "./types";

const log = createLogger("mcp-manager");

const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const TOOL_DESC_MAX_BYTES = 4 * 1024;

interface McpServerHandle {
  name: string;
  server: McpServerConfig & { name: string };
  status: McpConnectionStatus;
  error?: string;
  client: Client;
  transport: Transport;
  tools: McpToolInfo[];
  connectedAt?: number;
  /** One-shot idle timer; cleared on activity, restarted on disconnect. */
  idleTimer?: ReturnType<typeof setTimeout>;
}

declare global {
  var __mcp:
    | {
        handles: Map<string, McpServerHandle>;
        locks: Map<string, Promise<McpServerHandle>>;
      }
    | undefined;
  var __mcpShutdownHook: boolean | undefined;
}

function getGlobal(): {
  handles: Map<string, McpServerHandle>;
  locks: Map<string, Promise<McpServerHandle>>;
} {
  if (!globalThis.__mcp) {
    globalThis.__mcp = { handles: new Map(), locks: new Map() };
    if (!globalThis.__mcpShutdownHook) {
      globalThis.__mcpShutdownHook = true;
      const cleanup = () => {
        // Best-effort; OK if `globalThis.__mcp` was cleared.
        const g = globalThis.__mcp;
        if (!g) return;
        for (const handle of g.handles.values()) {
          try {
            void handle.transport.close();
          } catch {
            /* ignore */
          }
        }
        g.handles.clear();
      };
      process.once("exit", cleanup);
      process.once("SIGINT", cleanup);
      process.once("SIGTERM", cleanup);
    }
  }
  return globalThis.__mcp;
}

// ── Helpers ──────────────────────────────────────────────────────────

function freshHandle(
  server: McpServerConfig & { name: string },
): McpServerHandle {
  const { transport, clientName } = buildTransport(server);
  const client = buildClient(clientName, MCP_CLIENT_VERSION);
  return {
    name: server.name,
    server,
    status: "connecting",
    client,
    transport,
    tools: [],
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function truncateDescription(s: string | undefined): string | undefined {
  if (!s) return s;
  // Cut at byte boundary, not codepoint — UI shows as <pre>, broken
  // last char is fine; UTF-8 safe enough at the boundary we use.
  const bytes = Buffer.byteLength(s, "utf8");
  if (bytes <= TOOL_DESC_MAX_BYTES) return s;
  // Reserve 12 bytes for the truncation sentinel so the user sees the
  // signal even when the original content is exactly 4 KiB.
  const cut = s.slice(0, Math.floor((TOOL_DESC_MAX_BYTES - 12) * 4));
  return cut + "… [truncated]";
}

function resetIdleTimer(handle: McpServerHandle): void {
  if (handle.idleTimer) clearTimeout(handle.idleTimer);
  handle.idleTimer = setTimeout(() => {
    log.info("idle timeout, disconnecting", { name: handle.name });
    void mcpManager.disconnect(handle.name).catch((e) =>
      log.warn("idle disconnect failed", { name: handle.name, error: String(e) }),
    );
  }, IDLE_TIMEOUT_MS);
}

function clearIdleTimer(handle: McpServerHandle): void {
  if (handle.idleTimer) {
    clearTimeout(handle.idleTimer);
    handle.idleTimer = undefined;
  }
}

async function safeClose(handle: McpServerHandle): Promise<void> {
  clearIdleTimer(handle);
  try {
    await handle.transport.close();
  } catch (e) {
    log.warn("transport.close failed", { name: handle.name, error: String(e) });
  }
  try {
    await handle.client.close();
  } catch {
    /* client.close is best-effort; ignore */
  }
}

function viewFor(name: string): McpServerView {
  const g = getGlobal();
  const handle = g.handles.get(name);
  if (!handle) {
    const cfg = readMcpConfig();
    const cfgEntry = cfg.servers.find((s) => (s as { name?: string }).name === name);
    return {
      name,
      transport: cfgEntry?.transport ?? "stdio",
      enabled: cfgEntry?.enabled !== false,
      status: "disconnected",
    };
  }
  const status = handle.status;
  const v: McpServerView = {
    name,
    transport: handle.server.transport,
    enabled: handle.server.enabled !== false,
    status,
    tools: handle.tools.length,
    toolNames: handle.tools.map((t) => t.name),
  };
  if (status === "connected") v.connectedAt = handle.connectedAt;
  if (status === "error" && handle.error) v.error = handle.error;
  return v;
}

// ── Public surface ───────────────────────────────────────────────────

export const mcpManager = {
  listServers(): { config: McpConfig; views: McpServerView[] } {
    const config = readMcpConfig();
    // Include disabled servers too so the UI can show "disabled" rows
    // and let the user re-enable them.
    const views = config.servers.map((s) => {
      const name = (s as { name?: string }).name ?? "unnamed";
      return viewFor(name);
    });
    return { config, views };
  },

  getStatus(name: string): McpServerView | undefined {
    const g = getGlobal();
    if (!g.handles.has(name)) return undefined;
    return viewFor(name);
  },

  async connect(name: string): Promise<McpServerView> {
    const g = getGlobal();
    const existing = g.handles.get(name);
    if (existing && existing.status === "connected") return viewFor(name);

    const inflight = g.locks.get(name);
    if (inflight) {
      await inflight.catch(() => undefined);
      return viewFor(name);
    }

    const cfg = readMcpConfig();
    const raw = cfg.servers.find((s) => (s as { name?: string }).name === name);
    if (!raw) throw new Error(`unknown mcp server: ${name}`);
    if (raw.enabled === false) throw new Error(`mcp server disabled: ${name}`);
    const server = { name, ...raw } as McpServerConfig & { name: string };

    const work = (async () => {
      const startedAt = Date.now();
      // Tear down any half-open prior handle (a previous failed connect
      // leaves its entry behind so the UI can render the error; replace).
      if (existing) await safeClose(existing);

      const handle = freshHandle(server);
      // Expensive-looking but cheap: a brand-new handle always wins.
      g.handles.set(name, handle);
      try {
        await withTimeout(
          handle.client.connect(handle.transport),
          CONNECT_TIMEOUT_MS,
          "connect",
        );
        const list = await handle.client.listTools();
        handle.tools = (list.tools ?? []).map((t) => ({
          name: t.name,
          description: truncateDescription(t.description),
          inputSchema: t.inputSchema,
        }));
        handle.status = "connected";
        handle.connectedAt = Date.now();
        handle.error = undefined;
        resetIdleTimer(handle);
        log.info("connected", {
          name,
          tools: handle.tools.length,
          durationMs: elapsedMs(startedAt),
        });
        return handle;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        handle.status = "error";
        handle.error = msg;
        await safeClose(handle);
        // Drop the handle so re-trying is a fresh start.
        g.handles.delete(name);
        log.warn("connect failed", { name, error: msg });
        throw new Error(msg);
      }
    })();

    g.locks.set(name, work);
    try {
      await work;
    } finally {
      g.locks.delete(name);
    }
    return viewFor(name);
  },

  async disconnect(name: string): Promise<void> {
    const g = getGlobal();
    const handle = g.handles.get(name);
    if (!handle) return;
    g.handles.delete(name);
    await safeClose(handle);
    log.info("disconnected", { name });
  },

  async listTools(
    name: string,
    opts?: { refresh?: boolean },
  ): Promise<McpToolInfo[]> {
    const g = getGlobal();
    let handle = g.handles.get(name);
    if (!handle || handle.status !== "connected") {
      // Trigger a connect so the caller always sees tools after a
      // generic list. Most callers follow up with a callTool anyway,
      // so saving one round-trip matters.
      await mcpManager.connect(name);
      handle = g.handles.get(name);
    }
    if (!handle || handle.status !== "connected") {
      throw new Error(`server not connected: ${name} (${handle?.error ?? "unknown"})`);
    }
    resetIdleTimer(handle);
    if (opts?.refresh) {
      const list = await handle.client.listTools();
      handle.tools = (list.tools ?? []).map((t) => ({
        name: t.name,
        description: truncateDescription(t.description),
        inputSchema: t.inputSchema,
      }));
    }
    return handle.tools;
  },

  async callTool(
    name: string,
    toolName: string,
    args: unknown,
  ): Promise<McpCallResult> {
    const g = getGlobal();
    const tryCall = async (): Promise<McpCallResult> => {
      const handle = g.handles.get(name);
      if (!handle || handle.status !== "connected") {
        throw new Error(`server not connected: ${name}`);
      }
      resetIdleTimer(handle);
      const configuredTimeout = (handle.server as { timeout_ms?: number }).timeout_ms;
      const timeoutMs = configuredTimeout && configuredTimeout > 0 ? configuredTimeout : 30_000;
      const raw = await withTimeout(
        handle.client.callTool({ name: toolName, arguments: args as Record<string, unknown> }),
        timeoutMs,
        `callTool(${toolName})`,
      );
      // The MCP SDK returns isError + content. We surface both.
      const result = raw as { isError?: boolean; content?: unknown };
      const contentArr: unknown[] = Array.isArray(result.content) ? result.content : [];
      const content = normaliseContent(contentArr);
      return {
        isError: Boolean(result.isError),
        content,
      };
    };

    try {
      return await tryCall();
    } catch (e) {
      // One-shot auto-reconnect if the server's transport died. After
      // the second failure we surface the original error.
      const g2 = getGlobal();
      if (!g2.handles.has(name)) throw e;
      log.warn("callTool failed, attempting reconnect once", {
        name,
        toolName,
        error: String(e),
      });
      await mcpManager.disconnect(name);
      await mcpManager.connect(name);
      try {
        return await tryCall();
      } catch (e2) {
        throw e2 instanceof Error ? e2 : new Error(String(e2));
      }
    }
  },
};

/** Coerce an MCP `content` array into our trimmed shape. Unknown
 *  variants become a stub so the UI can still render "?" placeholders.
 *  The full image/audio base64 payload stays in `data`; clients that
 *  can't render it (e.g. the JSON drawer) get a small summary size. */
export function normaliseContent(raw: unknown[]): McpContent[] {
  const out: McpContent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const type = obj.type;
    if (type === "text" && typeof obj.text === "string") {
      out.push({ type: "text", text: obj.text });
    } else if (type === "image" && typeof obj.data === "string") {
      const mimeType = typeof obj.mimeType === "string" ? obj.mimeType : "image/png";
      out.push({ type: "image", mimeType, data: obj.data });
    } else if (type === "audio" && typeof obj.data === "string") {
      const mimeType = typeof obj.mimeType === "string" ? obj.mimeType : "audio/mpeg";
      out.push({ type: "audio", mimeType, data: obj.data });
    } else if (type === "resource") {
      out.push({ type: "resource", resource: obj });
    }
  }
  return out;
}


