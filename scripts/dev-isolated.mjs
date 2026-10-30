#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function expandTilde(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

const DEFAULT_PORT = 30143;
const DEFAULT_TERM_PORT = 30144;

const port = Number(arg("port", DEFAULT_PORT));
const termPort = Number(arg("term-port", DEFAULT_TERM_PORT));
const dataDir = expandTilde(arg("data-dir", "~/.pi-work-dev"));
const agentDir = expandTilde(arg("agent-dir", "~/.pi-dev/agent"));
const baseUrl = arg("base-url", `http://localhost:${port}`);

let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [process.cwd()] });
} catch {
  const nextPkg = require.resolve("next/package.json", { paths: [process.cwd()] });
  nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
}

const env = {
  ...process.env,
  PI_WORK_DATA_DIR: dataDir,
  PI_CODING_AGENT_DIR: agentDir,
  PI_WORK_TERMINAL_PORT: String(termPort),
  PI_WORK_PUBLIC_BASE_URL: baseUrl,
  NEXT_DIST_DIR: ".next-isolated",
};

console.log("── pi-work isolated dev ──────────────────────────────────────");
console.log(`  web    http://localhost:${port}   (prod default is 30141)`);
console.log(`  ws     terminal port  ${termPort}   (prod default is 30142)`);
console.log(`  data   ${dataDir}`);
console.log(`  agent  ${agentDir}`);
console.log("──────────────────────────────────────────────────────────────");
console.log("This instance is fully isolated from the production data root");
console.log("and builds into .next-isolated (never touches the shared .next).");
console.log("Fresh agent dirs have no auth/models — log in / pick a model,");
console.log("or seed with:  cp -r ~/.pi/agent ~/.pi-dev/agent");

const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env,
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  child.kill(signal);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code) => {
  process.exit(code ?? 0);
});