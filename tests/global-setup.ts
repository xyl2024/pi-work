/**
 * Vitest global setup: makes sure an *isolated* Pi Work instance is available
 * for the interface test suite.
 *
 * Strategy:
 *   1. probe TEST_BASE_URL (default: the isolated instance on port 30143) —
 *      if it answers, reuse it and leave it running afterwards;
 *   2. otherwise start it ourselves (`next dev`, same as
 *      `pnpm run dev:isolated`) and stop it on teardown.
 *
 * There is deliberately no production-shaped run: tests never build or start
 * a production server, and never target a production instance.
 *
 * Isolation is identical in both modes (same layout as scripts/dev-isolated.mjs):
 * PI_WORK_DATA_DIR=~/.pi-work-dev, PI_CODING_AGENT_DIR=~/.pi-dev/agent,
 * terminal WS on its own port. Never touches the production instance
 * (including its .next/ artifacts — test builds go to .next-test/) or the
 * real ~/.pi / ~/.pi-work data.
 *
 * Caveat: none — test builds go to .next-test/ (via NEXT_DIST_DIR), so the
 * shared .next/ of a running production server is never touched.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  ISOLATED_AGENT_DIR,
  ISOLATED_DATA_DIR,
  SERVER_BOOT_TIMEOUT_MS,
  TEST_BASE_URL,
  TEST_PORT,
  TEST_TERM_PORT,
} from "./config";

let server: ChildProcess | undefined;
/** True when global-setup started the instance itself (→ stop it on teardown). */
let owned = false;

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Resolve next's CLI entry (same trick as scripts/dev-isolated.mjs). */
function resolveNext(): string {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("next/dist/bin/next", { paths: [process.cwd()] });
  } catch {
    const nextPkg = require.resolve("next/package.json", { paths: [process.cwd()] });
    return path.join(path.dirname(nextPkg), "dist", "bin", "next");
  }
}

function isolatedEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PI_WORK_DATA_DIR: expandTilde(ISOLATED_DATA_DIR),
    PI_CODING_AGENT_DIR: expandTilde(ISOLATED_AGENT_DIR),
    PI_WORK_TERMINAL_PORT: String(TEST_TERM_PORT),
    PI_WORK_PUBLIC_BASE_URL: TEST_BASE_URL,
    // Own build artifacts dir: a production server serving from this checkout
    // reads .next/ — tests must never write into it (next.config.ts honors
    // NEXT_DIST_DIR).
    NEXT_DIST_DIR: ".next-test",
  };
}

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(TEST_BASE_URL, { redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + SERVER_BOOT_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(`Isolated server exited early with code ${server.exitCode}`);
    }
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Isolated server did not become ready at ${TEST_BASE_URL}: ${String(lastError)}`);
}

function runNext(args: string[], opts: { detached?: boolean } = {}): ChildProcess {
  return spawn(process.execPath, [resolveNext(), ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    detached: opts.detached ?? false,
    env: isolatedEnv(),
  });
}

export async function setup(): Promise<void> {
  if (await probe()) {
    console.log(`[test] reusing running isolated instance at ${TEST_BASE_URL}`);
    return;
  }

  console.log(`[test] starting isolated dev server at ${TEST_BASE_URL} ...`);

  // detached so we can kill the whole process tree (next server + terminal WS server)
  server = runNext(["dev", "-p", String(TEST_PORT)], { detached: true });
  owned = true;
  await waitForServer();
}

export async function teardown(): Promise<void> {
  if (!owned || !server?.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  const exited = new Promise<void>((resolve) => server?.on("exit", () => resolve()));
  const killer = new Promise<void>((resolve) =>
    setTimeout(() => {
      try {
        if (server?.pid) process.kill(-server.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      resolve();
    }, 10_000),
  );
  await Promise.race([exited, killer]);
}
