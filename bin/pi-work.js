#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const { values: cliArgs } = parseArgs({
  options: {
    port:     { type: "string", short: "p" },
    hostname: { type: "string", short: "H" },
    "no-open": { type: "boolean" },
  },
  strict: false,
});

const port     = cliArgs.port     ?? process.env.PORT     ?? "30141";

const isDesktop = (process.env.PI_WORK_DESKTOP ?? "").trim() !== "";
const hostname = isDesktop
  ? "127.0.0.1"
  : cliArgs.hostname ?? process.env.HOSTNAME ?? null;

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

const runtimeCwd = process.env.PI_WORK_WORKDIR || process.cwd();
const nextArgs = ["start", pkgDir, "-p", port];
if (hostname) nextArgs.push("-H", hostname);

const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: runtimeCwd,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env },
});

const openBrowser = cliArgs["no-open"] !== true;

let browserOpened = false;
const url = `http://${hostname ?? "localhost"}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
    spawn(openCmd, [url], { shell: isWindows, stdio: "ignore", detached: true }).unref();
  }
});

let shuttingDown = false;
let forceKillTimer = null;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (child.exitCode !== null || child.signalCode !== null) {
    process.exit(0);
  }

  child.kill(signal);
  forceKillTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }, 5000);
  forceKillTimer.unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code) => {
  if (forceKillTimer) clearTimeout(forceKillTimer);
  process.exit(code ?? 0);
});
