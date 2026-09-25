/**
 * Standalone WebSocket terminal server for Pi Work.
 *
 * Runs on its own port (default 30142, override with PI_WORK_TERMINAL_PORT)
 * so the Next.js App Router — whose route handlers cannot accept WebSocket
 * upgrades — never needs a custom server. The frontend fetches { port, token }
 * from `GET /api/terminal` and connects with `?token=...` in the URL.
 *
 * Security: every connection is gated by a per-process random token. The
 * token is exposed only through the authenticated-enough `/api/terminal`
 * route (same trust boundary as the rest of Pi Work). The default bind host is
 * loopback; set PI_WORK_TERMINAL_HOST=0.0.0.0 to let LAN clients reach it with
 * the token. Desktop mode (PI_WORK_DESKTOP) forces loopback regardless — see
 * lib/shared/trust-boundary.ts.
 *
 * Protocol (JSON text frames):
 *   client → server: { type: "start", cwd, sessionId? } | { type: "data", data }
 *                    | { type: "resize", cols, rows } | { type: "kill", sessionId? }
 *   server → client: { type: "data", data } | { type: "exit", code }
 *                    | { type: "error", message }
 *
 * Sessions survive WebSocket disconnects: each `start` names a client-chosen
 * `sessionId`; the server keeps the pty alive (plus a scrollback ring buffer)
 * in a registry so a page refresh can re-attach by sending `start` with the
 * same `sessionId` — the buffered output is replayed first. A pty is only
 * killed by an explicit `kill` message or when it exits on its own.
 */

import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { existsSync, statSync } from "fs";
import { isAbsolute } from "path";
import { homedir } from "os";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { createLogger } from "@/lib/server/logger";
import { sanitizeChildEnv } from "@/lib/server/env-sanitize";
import { currentInteractiveShell } from "@/lib/server/interactive-shell";
import { currentTerminalHost } from "@/lib/server/trust-boundary";

const log = createLogger("terminal/server");

const DEFAULT_PORT = 30142;
const HOST = currentTerminalHost();
const PORT = Number(process.env.PI_WORK_TERMINAL_PORT ?? DEFAULT_PORT);

export interface TerminalServerInfo {
  port: number;
  token: string;
}

// The runtime lives on globalThis — like rpc-manager's __piSessions — so a
// dev-mode hot reload (which re-evaluates this module) never double-binds the
// port: a stale module instance sees the existing runtime and reuses it.
interface TerminalRuntime {
  httpServer: Server;
  wss: WebSocketServer;
  info: TerminalServerInfo;
  /** sessionId → live pty session; survives page refreshes and ws reconnects. */
  sessions: Map<string, TerminalSession>;
}

interface TerminalSession {
  pty: pty.IPty;
  /** Scrollback replay buffer (joined chunks, capped at MAX_BUFFER_BYTES). */
  buffer: string[];
  bufferSize: number;
  /** Currently attached WebSocket clients (may be 0 while the tab is hidden). */
  clients: Set<WebSocket>;
  createdAt: number;
}

/** Cap on the replayed scrollback per session (bytes of UTF-16 string data). */
const MAX_BUFFER_BYTES = 512 * 1024;
/** Cap on simultaneously kept-alive sessions; the oldest is reaped first. */
const MAX_SESSIONS = 50;

const g = globalThis as unknown as { __piTerminalRuntime?: TerminalRuntime };

/** Info the frontend needs to connect: the WS port plus the auth token. */
export function getTerminalInfo(): TerminalServerInfo | null {
  return g.__piTerminalRuntime?.info ?? null;
}

/** Expand a leading "~" to the home dir; reject non-absolute, missing or non-dir paths. */
function normalizeCwd(cwd: string): { ok: true; path: string } | { ok: false; message: string } {
  const expanded = cwd === "~" || cwd.startsWith("~/") ? cwd.replace(/^~/, homedir()) : cwd;
  if (!isAbsolute(expanded)) {
    return { ok: false, message: `Not an absolute path: ${cwd}` };
  }
  if (!existsSync(expanded) || !statSync(expanded).isDirectory()) {
    return { ok: false, message: `Not a directory: ${expanded}` };
  }
  return { ok: true, path: expanded };
}

function appendToBuffer(session: TerminalSession, data: string): void {
  session.buffer.push(data);
  session.bufferSize += data.length;
  while (session.bufferSize > MAX_BUFFER_BYTES && session.buffer.length > 1) {
    const dropped = session.buffer.shift();
    session.bufferSize -= dropped?.length ?? 0;
  }
}

function reapOldestSession(sessions: Map<string, TerminalSession>): void {
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (const [key, session] of sessions) {
    if (session.createdAt < oldestAt) {
      oldestAt = session.createdAt;
      oldestKey = key;
    }
  }
  if (oldestKey) killSession(sessions, oldestKey);
}

function killSession(sessions: Map<string, TerminalSession>, sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  try {
    session.pty.kill();
  } catch {
    // already dead
  }
}

function handleConnection(ws: WebSocket): void {
  const sessions = g.__piTerminalRuntime?.sessions;
  /** Sessions this connection currently has attached (for cleanup on close). */
  const attached = new Set<TerminalSession>();

  const send = (obj: Record<string, unknown>): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  const broadcast = (session: TerminalSession, obj: Record<string, unknown>): void => {
    const payload = JSON.stringify(obj);
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  const spawnSession = (sessionId: string, cwdPath: string): TerminalSession | null => {
    if (!sessions) return null;
    // We explicitly build the pty env from a sanitised copy of
    // `process.env` rather than passing `{ ...process.env }`:
    // the launcher (`pi-work-start`) injects `NODE_ENV=production`,
    // `PORT=14514`, `HOSTNAME`, internal tokens, WSL/Win interop
    // vars, and a long `PATH` that includes Windows-side bins.
    // Without this scrub the user opens their terminal and
    // immediately finds `npm`/`git`/`code` behave as if they're
    // running inside the Pi Work production server.
    //
    // Build the env explicitly so this code path remains safe even
    // when instrumentation is skipped (e.g. NEXT_RUNTIME !== "nodejs").
    // `TERM` is forced to `xterm-256color` because that's what the
    // front-end xterm.js advertises; preserving the host's TERM
    // can mislead the shell into 16-colour mode.
    let ptyProcess: pty.IPty;
    const shell = currentInteractiveShell();
    try {
      const ptyEnv = sanitizeChildEnv(process.env);
      ptyEnv.TERM = "xterm-256color";
      ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: cwdPath,
        env: ptyEnv as Record<string, string>,
      });
    } catch (err) {
      send({ type: "error", message: `Failed to start shell: ${String(err)}` });
      return null;
    }
    if (sessions.size >= MAX_SESSIONS) reapOldestSession(sessions);
    const session: TerminalSession = {
      pty: ptyProcess,
      buffer: [],
      bufferSize: 0,
      clients: new Set(),
      createdAt: Date.now(),
    };
    sessions.set(sessionId, session);
    ptyProcess.onData((data) => {
      appendToBuffer(session, data);
      broadcast(session, { type: "data", data });
    });
    ptyProcess.onExit(({ exitCode }) => {
      // Session is gone once its shell exits — clear the registry entry.
      if (sessions.get(sessionId) === session) sessions.delete(sessionId);
      attached.delete(session);
      session.clients.clear();
      send({ type: "exit", code: exitCode });
    });
    log.info("pty started", { sessionId, cwd: cwdPath, shell });
    return session;
  };

  const attachSession = (sessionId: string, session: TerminalSession): void => {
    session.clients.add(ws);
    attached.add(session);
    // Replay the scrollback first; the JS event loop guarantees no pty `data`
    // event interleaves between the replay and the return of this handler.
    if (session.buffer.length > 0) send({ type: "data", data: session.buffer.join("") });
  };

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send({ type: "error", message: "Invalid JSON" });
      return;
    }
    switch (msg.type) {
      case "start": {
        const cwd = typeof msg.cwd === "string" ? msg.cwd : homedir();
        const sessionId = typeof msg.sessionId === "string" && msg.sessionId ? msg.sessionId : null;
        if (!sessionId) {
          send({ type: "error", message: "Missing sessionId" });
          return;
        }
        const existing = sessions?.get(sessionId);
        if (existing) {
          // Re-attach: keep the live shell and replay its scrollback. The
          // client follows up with `resize` to match its current dimensions.
          attachSession(sessionId, existing);
          return;
        }
        const normalized = normalizeCwd(cwd);
        if (!normalized.ok) {
          send({ type: "error", message: normalized.message });
          return;
        }
        const session = spawnSession(sessionId, normalized.path);
        if (session) attachSession(sessionId, session);
        break;
      }
      case "data": {
        const data = msg.data;
        if (typeof data !== "string") break;
        // Write to every attached session (in practice exactly one).
        for (const session of attached) {
          try {
            session.pty.write(data);
          } catch {
            // shell may be mid-exit — ignore
          }
        }
        break;
      }
      case "resize": {
        const cols = Number(msg.cols);
        const rows = Number(msg.rows);
        if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) break;
        for (const session of attached) {
          try {
            session.pty.resize(cols, rows);
          } catch {
            // shell may be mid-exit — ignore
          }
        }
        break;
      }
      case "kill": {
        const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : null;
        if (sessionId) {
          killSession(sessions ?? new Map(), sessionId);
        } else {
          // Legacy/no-id kill: tear down everything this connection attached.
          if (sessions) for (const session of attached) {
            for (const [key, value] of sessions) if (value === session) killSession(sessions, key);
          }
        }
        break;
      }
      default: {
        send({ type: "error", message: `Unknown message type: ${String(msg.type)}` });
      }
    }
  });

  // Disconnecting does NOT kill the pty — sessions are kept alive so the
  // frontend can re-attach after a page refresh. Clients send an explicit
  // `kill` when they really want the shell gone.
  ws.on("close", () => {
    for (const session of attached) session.clients.delete(ws);
    attached.clear();
  });
  ws.on("error", () => {
    for (const session of attached) session.clients.delete(ws);
    attached.clear();
  });
}

/**
 * Boot the terminal server. Idempotent — safe to call from both
 * `instrumentation.ts` and the `/api/terminal` route.
 */
export async function startTerminalServer(): Promise<TerminalServerInfo> {
  if (g.__piTerminalRuntime) return g.__piTerminalRuntime.info;

  const token = randomBytes(32).toString("hex");
  const wss = new WebSocketServer({ noServer: true });
  const httpServer: Server = createServer((_req, res) => {
    // Minimal HTTP endpoint so the port is easy to probe/health-check.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  wss.on("connection", handleConnection);

  httpServer.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.searchParams.get("token") !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(PORT, HOST, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const runtime: TerminalRuntime = { httpServer, wss, info: { port: PORT, token }, sessions: new Map() };
  g.__piTerminalRuntime = runtime;
  log.info(`terminal server listening on ${HOST}:${PORT}`);
  return runtime.info;
}
