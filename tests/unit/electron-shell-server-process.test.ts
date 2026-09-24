// The Electron shell's server process: electron-shell/server-process.js decides
// whether this launch needs one, what it is launched with (configured env +
// command line), how the window is signed for, and how it is stopped.
// Every fact it needs arrives as an argument, so all of it can be driven from
// here without Electron, a server or a spawn (same shape as
// tests/unit/electron-shell-window-rules.test.ts).
//
// Two of those facts are *duplicated* from the server side on purpose — the
// shell is plain CommonJS with no bundler, so it cannot import
// lib/server/auth.ts. The drift is caught here instead: the last describe block
// feeds a shell-signed token to the server's own verifier and compares the
// cookie name/TTL with the ones the server exports.
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_COOKIE_NAME, AUTH_SESSION_TTL_MS, verifySessionToken } from "@/lib/server/auth";
import {
  AUTH_COOKIE_NAME as SHELL_COOKIE_NAME,
  SESSION_TTL_MS as SHELL_SESSION_TTL_MS,
  buildServerEnv,
  findFreePort,
  killPlan,
  mintSecret,
  shouldSpawnServer,
  serverCommand,
  signSessionToken,
  waitForServer,
} from "../../electron-shell/server-process.js";
import { PROD_PORT } from "../../electron-shell/window-rules.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const APP_ROOT = repoRoot;
const PI_WORK_BIN = path.join(APP_ROOT, "bin", "pi-work.js");
const SERVER_PROCESS = path.join(APP_ROOT, "electron-shell", "server-process.js");
const LINUX_RUNTIME = path.join("/opt/pi-work/resources/runtime", "node");

/** A `existsSync` stand-in: only the listed paths exist. */
const onlyExisting =
  (...paths: string[]) =>
  (candidate: unknown) =>
    paths.includes(String(candidate));

/** The env builder returns a plain bag of strings; index it as one. */
const asEnv = (env: unknown): Record<string, string | undefined> =>
  env as Record<string, string | undefined>;

/** Bind the port for real, then release it — proves it was actually free. */
function bindAndClose(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen({ port, host: "127.0.0.1" }, () => server.close(() => resolve()));
  });
}

describe("shouldSpawnServer", () => {
  it("spawns one for a plain packaged launch", () => {
    expect(shouldSpawnServer({ dev: false, env: {} })).toBe(true);
  });

  it("never spawns in dev mode — the isolated instance owns that port", () => {
    expect(shouldSpawnServer({ dev: true, env: {} })).toBe(false);
  });

  it("leaves an explicitly handed-over port alone", () => {
    // `PI_PORT` means "a server is already running, point at it" — that is the
    // documented way to attach the shell to a server someone else started.
    expect(shouldSpawnServer({ dev: false, env: { PI_PORT: "30141" } })).toBe(false);
  });

  it("ignores an unusable PI_PORT", () => {
    for (const value of ["", "  ", "abc", "0", "-1", "70000"]) {
      expect(shouldSpawnServer({ dev: false, env: { PI_PORT: value } })).toBe(true);
    }
  });
});

describe("findFreePort", () => {
  it("returns a free loopback port, not the production default", async () => {
    const port = await findFreePort();

    expect(port).toBeGreaterThan(1023);
    expect(port).toBeLessThan(65536);
    expect(String(port)).not.toBe(PROD_PORT);
    await expect(bindAndClose(port)).resolves.toBeUndefined();
  });

  it("gives every concurrent caller its own port", async () => {
    const ports = await Promise.all([findFreePort(), findFreePort(), findFreePort()]);

    expect(new Set(ports).size).toBe(3);
  });
});

describe("mintSecret", () => {
  it("mints a fresh high-entropy secret per launch", () => {
    const first = mintSecret();
    const second = mintSecret();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
  });
});

describe("buildServerEnv", () => {
  const base = { PATH: "/usr/bin", HOME: "/home/u", PI_WORK_AUTH_PASSWORD: "hunter2" };

  it("turns the child into the desktop track on the port the shell picked", () => {
    const env = asEnv(
      buildServerEnv({ env: base, port: 45678, terminalPort: 45679, secret: "s3cret" })
    );

    expect(env).toMatchObject({
      PI_WORK_DESKTOP: "1",
      PI_WORK_DESKTOP_SECRET: "s3cret",
      PORT: "45678",
      PI_WORK_TERMINAL_PORT: "45679",
      NODE_ENV: "production",
    });
    expect(env.PATH).toBe("/usr/bin");
  });

  it("drops the shell's own inputs and the credential pair", () => {
    const env = asEnv(
      buildServerEnv({
        env: { ...base, PI_PORT: "30141", ELECTRON_RUN_AS_NODE: "1" },
        port: 45678,
        terminalPort: 45679,
        secret: "s3cret",
      })
    );

    // PI_PORT is the shell's input, not the server's (it reads PORT).
    expect(env.PI_PORT).toBeUndefined();
    // The child must be a real Node, never an Electron binary in Node mode.
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    // Desktop mode has no login page, so it must not carry credentials that a
    // fallback could resurrect when PI_WORK_DESKTOP_SECRET is empty.
    expect(env.PI_WORK_AUTH_PASSWORD).toBeUndefined();
    expect(env.PI_WORK_AUTH_USERNAME).toBeUndefined();
  });

  it("never mutates the environment it was handed", () => {
    const source = { ...base };
    const env = buildServerEnv({ env: source, port: 45678, terminalPort: 45679, secret: "s" });

    expect(source).toEqual(base);
    expect(env).not.toBe(source);
  });});

describe("serverCommand", () => {
  const port = 45678;

  it("runs bin/pi-work.js with the bundled Node runtime", () => {
    const plan = serverCommand({
      appRoot: APP_ROOT,
      resourcesPath: "/opt/pi-work/resources",
      platform: "linux",
      env: {},
      port,
      exists: onlyExisting(LINUX_RUNTIME),
    });

    expect(plan).toEqual({
      ok: true,
      command: LINUX_RUNTIME,
      args: [PI_WORK_BIN, "--port", "45678", "--no-open"],
    });
  });

  it("names the Windows runtime node.exe", () => {
    const runtime = path.join("C:\\pi-work\\resources", "runtime", "node.exe");
    const plan = serverCommand({
      appRoot: "C:\\pi-work",
      resourcesPath: "C:\\pi-work\\resources",
      platform: "win32",
      env: {},
      port,
      exists: onlyExisting(runtime),
    });

    expect(plan).toMatchObject({ ok: true, command: runtime });
  });

  it("refuses to fall back to Electron's own Node", () => {
    const plan = serverCommand({
      appRoot: APP_ROOT,
      resourcesPath: "/opt/pi-work/resources",
      platform: "linux",
      env: {},
      port,
      exists: () => false,
    });

    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.reason).toContain("PI_WORK_NODE");
    expect(plan).not.toHaveProperty("command");
  });

  it("lets PI_WORK_NODE point at a runtime outside the bundle", () => {
    const plan = serverCommand({
      appRoot: APP_ROOT,
      resourcesPath: "/opt/pi-work/resources",
      platform: "linux",
      env: { PI_WORK_NODE: "/usr/local/bin/node" },
      port,
      exists: onlyExisting("/usr/local/bin/node"),
    });

    expect(plan).toMatchObject({ ok: true, command: "/usr/local/bin/node" });
  });
});

describe("killPlan", () => {
  it("kills the whole tree with taskkill on Windows", () => {
    expect(killPlan({ pid: 4242, platform: "win32", detached: false })).toEqual({
      method: "command",
      command: "taskkill",
      args: ["/pid", "4242", "/T", "/F"],
    });
  });

  it("signals the process group on POSIX, so no grandchild is orphaned", () => {
    expect(killPlan({ pid: 4242, platform: "linux", detached: true })).toEqual({
      method: "signal",
      pid: -4242,
      signal: "SIGTERM",
    });
  });

  it("falls back to the process itself when it has no group of its own", () => {
    expect(killPlan({ pid: 4242, platform: "darwin", detached: false })).toEqual({
      method: "signal",
      pid: 4242,
      signal: "SIGTERM",
    });
  });
});

describe("waitForServer", () => {
  const url = "http://127.0.0.1:45678";
  const sleep = async () => {};

  it("resolves as soon as the server answers, whatever it answers", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ status: 401 });

    await expect(waitForServer({ url, fetchImpl, sleep })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(url);
  });

  it("gives up at the deadline instead of hanging on a server that never starts", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      waitForServer({ url, timeoutMs: 1000, intervalMs: 250, fetchImpl, sleep })
    ).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("stops waiting once the process it is waiting for is gone", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      waitForServer({ url, fetchImpl, sleep, shouldAbort: () => true })
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not die on a probe that throws synchronously", async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error("boom");
    });

    await expect(waitForServer({ url, timeoutMs: 1, fetchImpl, sleep })).resolves.toBe(false);
  });
});

// The shell duplicates the cookie name, the TTL and the token format: it is
// plain CommonJS and cannot import lib/server/auth.ts. A silent drift here
// locks the packaged app out of its own server, which no other test can see.
describe("the shell's session contract matches the server's", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of ["PI_WORK_DESKTOP", "PI_WORK_DESKTOP_SECRET"]) {
      saved[name] = process.env[name];
    }
    process.env.PI_WORK_DESKTOP = "1";
    process.env.PI_WORK_DESKTOP_SECRET = "launch-1";
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("uses the server's cookie name and lifetime", () => {
    expect(SHELL_COOKIE_NAME).toBe(AUTH_COOKIE_NAME);
    expect(SHELL_SESSION_TTL_MS).toBe(AUTH_SESSION_TTL_MS);
  });

  it("signs a token the server accepts", () => {
    const token = signSessionToken({ secret: "launch-1" });

    expect(verifySessionToken(token)).toBe(true);
  });

  it("expires the token in the future, not the past", () => {
    const token = signSessionToken({ secret: "launch-1", now: 1_700_000_000_000 });

    expect(Number(token.split(".")[0])).toBe(1_700_000_000_000 + AUTH_SESSION_TTL_MS);
  });

  it("is rejected after a restart mints a new secret", () => {
    const token = signSessionToken({ secret: "launch-1" });
    process.env.PI_WORK_DESKTOP_SECRET = "launch-2";

    expect(verifySessionToken(token)).toBe(false);
  });
});

describe("the commands the shell builds really exist", () => {
  it("bin/pi-work.js is the production entry the shell spawns", () => {
    expect(existsSync(PI_WORK_BIN)).toBe(true);
  });

  it("bin/pi-work.js honours --no-open", () => {
    // Spawning it must not also open a browser tab (it does that for humans),
    // so the flag has to be read *and* the open-on-ready branch behind it.
    const source = readFileSync(PI_WORK_BIN, "utf8");
    expect(source).toMatch(/const openBrowser = cliArgs\["no-open"\] !== true;/);
    expect(source).toMatch(/if \(openBrowser && !browserOpened/);
  });
});

// ADR-0003: a rule-core module takes its dependencies as parameters instead of
// reading them. Here that is what lets `platform: "win32"` be driven from Linux
// (the Windows branch of killPlan/serverCommand), and it is why main.js — the
// half that cannot be unit-tested — is the only place that reads process.*.
describe("server-process.js stays a rule module", () => {
  it("never reads process.platform or process.env itself", () => {
    const source = readFileSync(SERVER_PROCESS, "utf8");
    // Comments legitimately discuss both ("never reads process.platform",
    // "no fallback to process.execPath"), so only code lines are checked.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");

    expect(code).not.toMatch(/process\.(platform|env)\b/);
  });
});
