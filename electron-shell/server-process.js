// server-process.js — the shell's own server process: whether this launch needs one,
// what it is launched with, how the window is signed for, and how it stops.
//
// Until #88 the shell assumed someone else had already started the server (the
// window just pointed at a port and showed an error page if nothing answered).
// A packaged build has no "someone else": the shell starts the server itself.
//
// The server runs on a *standalone Node runtime* bundled under
// `resources/runtime/` — never Electron's own Node. `better-sqlite3` and
// CodeGraph's tree-sitter are V8-ABI native modules: inside Electron they would
// have to be rebuilt for a different NODE_MODULE_VERSION (and rebuilt again on
// every Electron upgrade), while a plain Node process uses the published
// prebuilds unchanged. `node-pty` is N-API and does not care either way.
//
// (#88 calls this process the shell's "sidecar". That word already means a
// companion file sitting next to a session file in this repo — the session-name
// index, the notify binding — so this module is named after what it is: the
// server process the shell owns and reaps.)
//
// The impure half of that contract — spawning, probing over HTTP, writing the
// Electron session cookie, killing — lives in main.js. Everything *decided*
// here takes its inputs as arguments (`platform` included: this module never
// reads `process.platform`, the same rule window-rules.js follows) so it can be
// unit-tested without Electron, a server or a spawn
// (tests/unit/electron-shell-server-process.test.ts). The only outside reads
// left are the two injected defaults — `existsSync` and `globalThis.fetch` —
// which the tests replace.
//
// Two facts are duplicated from the server side and pinned by that test rather
// than by an import (this file is plain CommonJS: no bundler, no path aliases):
//
//   - the session cookie name and its lifetime (`lib/server/auth.ts`);
//   - the desktop session token format. The server's issuer is
//         key   = sha256("pi-work-desktop:" + PI_WORK_DESKTOP_SECRET)
//         token = `${expiresAtMs}.${hmacSha256(key, expiresAtMs)}`
//     and `verifySessionToken()` is its verifier. The signer below is the same
//     contract from the shell's side; the test feeds its output to the real
//     verifier, so a one-sided change turns red instead of locking the packaged
//     app out of its own server.
//
// Port defaults (dev/production) are window-rules.js' business, not this one.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createHash, createHmac, randomBytes } = require("node:crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync } = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const net = require("node:net");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { portOverride } = require("./window-rules.js");

/** Where the bundled runtime lives inside a packaged app (`extraResources`). */
const RUNTIME_DIR = "runtime";
/** The runtime's executable name per platform. */
const RUNTIME_BIN = { win32: "node.exe", default: "node" };

/** The cookie the whole web app reads (see lib/server/auth.ts). */
const AUTH_COOKIE_NAME = "pi-work-auth";
/** Session lifetime: 7 days, matching the cookie Max-Age. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Key-material namespace; must match lib/shared/trust-boundary.ts. */
const DESKTOP_KEY_PREFIX = "pi-work-desktop";

// ── Whether to spawn ─────────────────────────────────────────────────
/**
 * Whether this launch starts its own server.
 *
 * Two cases do not:
 *   - `--dev` points at the isolated dev instance, which the developer runs
 *     (`pnpm run dev:isolated`) so debugging never touches production data;
 *   - an explicit `PI_PORT` is the operator saying "a server is already
 *     running here, use it" — the shell's escape hatch from owning a process.
 */
function shouldSpawnServer({ dev, env = {} }) {
  if (dev) return false;
  return portOverride(env) === null;
}

// ── Port ─────────────────────────────────────────────────────────────
/**
 * Ask the OS for a free loopback port.
 *
 * Binding :0 and closing it is the only portable way to learn an unused port
 * before the server that will use it exists. The window between releasing it
 * and next's own bind is real but tiny; a lost race surfaces as "the server
 * never came up" with a retry button rather than as a fixed-port collision.
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen({ port: 0, host: "127.0.0.1" }, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// ── Credential ───────────────────────────────────────────────────────
/**
 * The per-launch secret. Every restart of the shell invalidates every cookie
 * the previous launch signed, which is the desktop track's whole trust story
 * (lib/shared/trust-boundary.ts): there is no stable credential to steal.
 */
function mintSecret() {
  return randomBytes(32).toString("hex");
}

/** The session HMAC key for a secret. Mirrors `lib/server/auth.ts`. */
function sessionKey(secret) {
  return createHash("sha256").update(`${DESKTOP_KEY_PREFIX}:${secret}`).digest();
}

/** A session token the server accepts — the shell's half of the contract. */
function signSessionToken({ secret, now = Date.now(), ttlMs = SESSION_TTL_MS }) {
  const expiresAtMs = now + ttlMs;
  const sig = createHmac("sha256", sessionKey(secret)).update(String(expiresAtMs)).digest("hex");
  return `${expiresAtMs}.${sig}`;
}

// ── Child process ────────────────────────────────────────────────────
/** Where the runtime is expected, for the error message when it is missing. */
function runtimePath({ resourcesPath, platform }) {
  if (!resourcesPath) return null;
  return path.join(resourcesPath, RUNTIME_DIR, RUNTIME_BIN[platform] ?? RUNTIME_BIN.default);
}

/**
 * The Node runtime the server runs on: the bundled one, or whatever
 * `PI_WORK_NODE` points at (how a source checkout — no packaging step — starts
 * the same production server). There is deliberately no fallback to
 * `process.execPath`: under Electron that is an Electron binary, and the whole
 * point of #88/D10 is not to run the server on it.
 */
function resolveNodeRuntime({ resourcesPath, platform, env = {}, exists = existsSync }) {
  const override = (env.PI_WORK_NODE ?? "").trim();
  if (override) return exists(override) ? override : null;
  const bundled = runtimePath({ resourcesPath, platform });
  if (!bundled) return null;
  return exists(bundled) ? bundled : null;
}

/**
 * The command that starts the production server.
 *
 * The entry is `bin/pi-work.js` — the same one `pnpm start` and the published
 * `pi-work` bin run, so the desktop track inherits its build check, its
 * "desktop mode binds loopback no matter what was asked" rule and its
 * signal-forwarding shutdown instead of re-implementing them. `--no-open`
 * keeps it from also opening a browser tab (that is for humans).
 */
function serverCommand({ appRoot, resourcesPath, platform, env = {}, port, exists = existsSync }) {
  const command = resolveNodeRuntime({ resourcesPath, platform, env, exists });
  if (!command) {
    const expected = (env.PI_WORK_NODE ?? "").trim() || runtimePath({ resourcesPath, platform });
    return {
      ok: false,
      reason: `未找到独立 Node 运行时（期望 ${expected ?? "resources/runtime/"}）；打包时请放入该目录，或用 PI_WORK_NODE 指定`,
    };
  }
  return {
    ok: true,
    command,
    args: [path.join(appRoot, "bin", "pi-work.js"), "--port", String(port), "--no-open"],
  };
}

/**
 * The environment for the server process.
 *
 * Three things are removed rather than inherited:
 *   - `PI_PORT` is the *shell's* input (window-rules.js); the server reads
 *     `PORT`, and a leftover PI_PORT would just be confusing;
 *   - `ELECTRON_RUN_AS_NODE` would turn an Electron binary into a Node — the
 *     one thing this whole design refuses to depend on;
 *   - `PI_WORK_AUTH_USERNAME` / `PI_WORK_AUTH_PASSWORD` are the *server*
 *     track's credentials. Desktop mode has no login page and derives its key
 *     from the per-launch secret only, so credentials here are dead config
 *     that could resurrect the built-in admin/admin pair if a secret ever went
 *     missing.
 */
function buildServerEnv({ env = {}, port, terminalPort, secret }) {
  const child = { ...env };
  delete child.PI_PORT;
  delete child.ELECTRON_RUN_AS_NODE;
  delete child.PI_WORK_AUTH_USERNAME;
  delete child.PI_WORK_AUTH_PASSWORD;
  return {
    ...child,
    PI_WORK_DESKTOP: "1",
    PI_WORK_DESKTOP_SECRET: secret,
    PORT: String(port),
    // The terminal service is its own listener: giving it a random port too
    // keeps a desktop launch from colliding with anything already on 30142.
    PI_WORK_TERMINAL_PORT: String(terminalPort),
    NODE_ENV: "production",
  };
}

/**
 * How to end the server process tree, so quitting leaves nothing behind.
 *
 * Windows has no process groups to signal: `taskkill /T /F` is the only way to
 * take the whole tree down (`child.kill()` would leave next's server running
 * and holding the port). POSIX signals the group when the child owns one —
 * both the entry and everything it spawned. Both are best-effort: if the tree
 * is already gone, the caller just logs the failure.
 */
function killPlan({ pid, platform, detached = false }) {
  if (platform === "win32") {
    return { method: "command", command: "taskkill", args: ["/pid", String(pid), "/T", "/F"] };
  }
  return { method: "signal", pid: detached ? -pid : pid, signal: "SIGTERM" };
}

// ── Readiness ────────────────────────────────────────────────────────
/**
 * Wait until something answers on the app's URL.
 *
 * Any HTTP response means the server is listening — including a 401 for an
 * unauthenticated probe. Waiting for a *successful* response would hang on
 * exactly the misconfiguration (a cookie the server refuses) that the shell
 * cannot fix by waiting. The attempt count is derived from the budget rather
 * than read off a clock, so the deadline is testable without fake timers.
 */
async function waitForServer({
  url,
  timeoutMs = 30_000,
  intervalMs = 250,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  shouldAbort = () => false,
}) {
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (shouldAbort()) return false;
    try {
      await fetchImpl(url);
      return true;
    } catch {
      // Not listening yet (or not listening any more) — try again.
    }
    if (attempt < attempts - 1) await sleep(intervalMs);
  }
  return false;
}

module.exports = {
  AUTH_COOKIE_NAME,
  SESSION_TTL_MS,
  RUNTIME_BIN,
  RUNTIME_DIR,
  buildServerEnv,
  findFreePort,
  killPlan,
  mintSecret,
  resolveNodeRuntime,
  shouldSpawnServer,
  serverCommand,
  signSessionToken,
  waitForServer,
};
