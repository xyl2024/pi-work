import {
  createBashToolDefinition,
  createPowerShellToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { BashSpawnContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { sanitizeChildEnv } from "@/lib/server/env-sanitize";

function privateEnv(context: BashSpawnContext): BashSpawnContext {
  return { ...context, env: sanitizeChildEnv(context.env) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShellToolDefinition = ToolDefinition<any, any, any>;

export function createPiWorkBashTool(cwd: string): ShellToolDefinition {
  return createBashToolDefinition(cwd, { spawnHook: privateEnv });
}

export function createPiWorkPowerShellTool(cwd: string): ShellToolDefinition {
  return createPowerShellToolDefinition(cwd, { spawnHook: privateEnv });
}
