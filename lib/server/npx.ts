import { execFile, spawn } from "child_process";
import { createInterface } from "readline";
import { promisify } from "util";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { execPath } from "process";

const execFileAsync = promisify(execFile);

function findNpxCli(): string | null {
  const nodeDir = dirname(execPath);
  const candidates = [
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {
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
  onLine: (line: string) => void;
}

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
