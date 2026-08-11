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
 * route (same trust boundary as the rest of Pi Work). Default bind host is
 * 0.0.0.0 so LAN clients can reach it with the token; set
 * PI_WORK_TERMINAL_HOST=127.0.0.1 to restrict to localhost only.
 *
 * Protocol (JSON text frames):
 *   client → server: { type: "start", cwd } | { type: "data", data }
 *                    | { type: "resize", cols, rows } | { type: "kill" }
 *   server → client: { type: "data", data } | { type: "exit", code }
 *                    | { type: "error", message }
 */

import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { existsSync, statSync } from "fs";
import { isAbsolute } from "path";
import { homedir } from "os";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { createLogger } from "@/lib/logger";

const log = createLogger("terminal/server");

const DEFAULT_PORT = 30142;
const HOST = process.env.PI_WORK_TERMINAL_HOST ?? "0.0.0.0";
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
}

const g = globalThis as unknown as { __piTerminalRuntime?: TerminalRuntime };

/** Info the frontend needs to connect: the WS port plus the auth token. */
export function getTerminalInfo(): TerminalServerInfo | null {
  return g.__piTerminalRuntime?.info ?? null;
}

function resolveShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "powershell.exe";
  }
  return process.env.SHELL || "bash";
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

function handleConnection(ws: WebSocket): void {
  let ptyProcess: pty.IPty | null = null;

  const send = (obj: Record<string, unknown>): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  const killPty = (): void => {
    if (!ptyProcess) return;
    try {
      ptyProcess.kill();
    } catch {
      // already dead
    }
    ptyProcess = null;
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
        const normalized = normalizeCwd(cwd);
        if (!normalized.ok) {
          send({ type: "error", message: normalized.message });
          return;
        }
        killPty();
        try {
          ptyProcess = pty.spawn(resolveShell(), [], {
            name: "xterm-256color",
            cols: 80,
            rows: 24,
            cwd: normalized.path,
            env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
          });
        } catch (err) {
          send({ type: "error", message: `Failed to start shell: ${String(err)}` });
          return;
        }
        ptyProcess.onData((data) => send({ type: "data", data }));
        ptyProcess.onExit(({ exitCode }) => {
          ptyProcess = null;
          send({ type: "exit", code: exitCode });
        });
        log.info("pty started", { cwd: normalized.path, shell: resolveShell() });
        break;
      }
      case "data": {
        if (ptyProcess && typeof msg.data === "string") ptyProcess.write(msg.data);
        break;
      }
      case "resize": {
        const cols = Number(msg.cols);
        const rows = Number(msg.rows);
        if (ptyProcess && Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
          try {
            ptyProcess.resize(cols, rows);
          } catch {
            // shell may be mid-exit — ignore
          }
        }
        break;
      }
      case "kill": {
        killPty();
        break;
      }
      default: {
        send({ type: "error", message: `Unknown message type: ${String(msg.type)}` });
      }
    }
  });

  ws.on("close", () => {
    killPty();
  });
  ws.on("error", () => {
    killPty();
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

  const runtime: TerminalRuntime = { httpServer, wss, info: { port: PORT, token } };
  g.__piTerminalRuntime = runtime;
  log.info(`terminal server listening on ${HOST}:${PORT}`);
  return runtime.info;
}
