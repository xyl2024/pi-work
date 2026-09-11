import { execFile, spawn } from "child_process";
import { createInterface } from "readline";
import { promisify } from "util";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { execPath } from "process";

const execFileAsync = promisify(execFile);

/**
 * Locate `npx-cli.js` shipped with the running Node.js installation.
 *
 * On Windows the `npx` on PATH is actually `npx.cmd`, which Node.js (since
 * 20.12 due to CVE-2024-27980) refuses to spawn from `execFile`/`spawn`
 * without `shell: true`. Going through a shell reintroduces quoting bugs for
 * user-supplied args. Instead we find the real `npx-cli.js` and invoke it
 * directly via the current `node` binary, which works identically on every
 * platform and needs no shell.
 */
function findNpxCli(): string | null {
  const nodeDir = dirname(execPath);
  const candidates = [
    // Windows MSI installer layout: node.exe and node_modules share a dir
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    // Unix layout: .../bin/node + .../lib/node_modules/npm/bin/npx-cli.js
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export interface RunNpxOptions {
  timeout?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunNpxResult {
  stdout: string;
  stderr: string;
}

/**
 * Cross-platform wrapper for invoking `npx <args>` without ever using a
 * shell, so user-controlled arguments are never interpreted as shell syntax.
 */
export async function runNpx(args: string[], opts: RunNpxOptions = {}): Promise<RunNpxResult> {
  const npxCli = findNpxCli();
  const { command, commandArgs } = npxCli
    ? { command: execPath, commandArgs: [npxCli, ...args] }
    : { command: "npx", commandArgs: args };
  return execFileAsync(command, commandArgs, {
    timeout: opts.timeout,
    cwd: opts.cwd,
    env: opts.env,
  });
}

export interface RunNpxStreamOptions extends RunNpxOptions {
  /** Called for each completed stdout/stderr line as it is produced. */
  onLine: (line: string) => void;
}

/**
 * Spawn-based variant of `runNpx` that streams completed output lines to
 * `onLine` while the process runs, so callers can surface live progress.
 * Returns the full stdout/stderr (ANSI codes included) once the child exits.
 * Rejects on spawn errors or, when `timeout` is set, kills the child and
 * rejects after the deadline.
 */
export async function runNpxStream(args: string[], opts: RunNpxStreamOptions): Promise<RunNpxResult> {
  const npxCli = findNpxCli();
  const { command, commandArgs } = npxCli
    ? { command: execPath, commandArgs: [npxCli, ...args] }
    : { command: "npx", commandArgs: args };

  return new Promise<RunNpxResult>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = opts.timeout
      ? setTimeout(() => {
          child.kill("SIGTERM");
        }, opts.timeout)
      : null;

    const wire = (stream: NodeJS.ReadableStream, sink: (chunk: string) => void) => {
      createInterface({ input: stream }).on("line", (line: string) => {
        sink(line + "\n");
        opts.onLine(line);
      });
    };
    wire(child.stdout!, (chunk) => (stdout += chunk));
    wire(child.stderr!, (chunk) => (stderr += chunk));

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) {
        const err = error as Error & { stdout?: string; stderr?: string };
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    };

    child.on("error", finish);
    child.on("close", () => finish(null));
  });
}
