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

const RUNTIME_DIR = "runtime";
const RUNTIME_BIN = { win32: "node.exe", default: "node" };

const AUTH_COOKIE_NAME = "pi-work-auth";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DESKTOP_KEY_PREFIX = "pi-work-desktop";

function shouldSpawnServer({ dev, env = {} }) {
  if (dev) return false;
  return portOverride(env) === null;
}

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

function mintSecret() {
  return randomBytes(32).toString("hex");
}

function sessionKey(secret) {
  return createHash("sha256").update(`${DESKTOP_KEY_PREFIX}:${secret}`).digest();
}

function signSessionToken({ secret, now = Date.now(), ttlMs = SESSION_TTL_MS }) {
  const expiresAtMs = now + ttlMs;
  const sig = createHmac("sha256", sessionKey(secret)).update(String(expiresAtMs)).digest("hex");
  return `${expiresAtMs}.${sig}`;
}

function runtimePath({ resourcesPath, platform }) {
  if (!resourcesPath) return null;
  return path.join(resourcesPath, RUNTIME_DIR, RUNTIME_BIN[platform] ?? RUNTIME_BIN.default);
}

function resolveNodeRuntime({ resourcesPath, platform, env = {}, exists = existsSync }) {
  const override = (env.PI_WORK_NODE ?? "").trim();
  if (override) return exists(override) ? override : null;
  const bundled = runtimePath({ resourcesPath, platform });
  if (!bundled) return null;
  return exists(bundled) ? bundled : null;
}

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
    PI_WORK_TERMINAL_PORT: String(terminalPort),
    NODE_ENV: "production",
  };
}

function killPlan({ pid, platform, detached = false }) {
  if (platform === "win32") {
    return { method: "command", command: "taskkill", args: ["/pid", String(pid), "/T", "/F"] };
  }
  return { method: "signal", pid: detached ? -pid : pid, signal: "SIGTERM" };
}

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
