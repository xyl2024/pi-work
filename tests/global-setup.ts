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
let owned = false;

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

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

  server = runNext(["dev", "-p", String(TEST_PORT)], { detached: true });
  owned = true;
  await waitForServer();
}

export async function teardown(): Promise<void> {
  if (!owned || !server?.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
  }
  const exited = new Promise<void>((resolve) => server?.on("exit", () => resolve()));
  const killer = new Promise<void>((resolve) =>
    setTimeout(() => {
      try {
        if (server?.pid) process.kill(-server.pid, "SIGKILL");
      } catch {
      }
      resolve();
    }, 10_000),
  );
  await Promise.race([exited, killer]);
}
