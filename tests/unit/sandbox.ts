import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import {
  MEMORY_ENTRY_SEPARATOR,
  MEMORY_TARGET_FILES,
  type MemoryTarget,
} from "@/lib/shared/memory";

const createdRoots: string[] = [];
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
const savedDataDir = process.env.PI_WORK_DATA_DIR;

export interface Sandbox {
  root: string;
  agentDir: string;
  dataDir: string;
  configPath: string;
}

export function resetPiWorkRuntimeState(): void {
  const globalState = globalThis as Record<string, unknown>;
  for (const key of Object.keys(globalState)) {
    if (!key.startsWith("__pi")) continue;
    const value = globalState[key];
    const close = (value as { close?: unknown } | null)?.close;
    if (typeof close === "function") close.call(value);
    delete globalState[key];
  }
}

export function createSandbox(prefix: string): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  createdRoots.push(root);
  const agentDir = path.join(root, "agent");
  const dataDir = path.join(root, "data");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORK_DATA_DIR = dataDir;
  resetPiWorkRuntimeState();
  return { root, agentDir, dataDir, configPath: path.join(dataDir, "config.yaml") };
}

export function seedMemoryLibrary(
  sandbox: Sandbox,
  target: MemoryTarget,
  entries: readonly string[],
): string {
  const file = path.join(sandbox.dataDir, "memory", MEMORY_TARGET_FILES[target]);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, entries.join(MEMORY_ENTRY_SEPARATOR), "utf8");
  return file;
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  if (savedDataDir === undefined) delete process.env.PI_WORK_DATA_DIR;
  else process.env.PI_WORK_DATA_DIR = savedDataDir;
  resetPiWorkRuntimeState();
});
