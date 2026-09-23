import {
  createBashToolDefinition,
  createPowerShellToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { BashSpawnContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { sanitizeChildEnv } from "@/lib/server/env-sanitize";

/**
 * Pi Work's own definitions for the two agent shells. The SDK's built-ins are
 * created over for one reason: the server process environment must stay
 * private. `spawnHook` runs after pi injected its own `PI_*` session variables
 * into the child environment and before the process is spawned — the documented
 * seam for handing a child a reduced environment — so `PI_WORK_*` (signing
 * credentials, data-root overrides) never reaches a command the agent wrote.
 *
 * Both shells get the same treatment: a machine with a second shell must not
 * have a second, unsanitized door into the server's environment.
 *
 * Everything else stays the SDK's: PowerShell keeps its
 * `[Console]::OutputEncoding = UTF8` prefix (and therefore readable
 * non-ASCII output) and `bash` keeps resolving Git Bash on Windows, because
 * neither definition passes `shellPath`. See
 * `lib/shared/agent-shell-tools.ts` for which of the two a platform gets.
 */

/** The `spawnHook` both shell tools share: the child env, minus server bookkeeping. */
function privateEnv(context: BashSpawnContext): BashSpawnContext {
  return { ...context, env: sanitizeChildEnv(context.env) };
}

// The SDK's generic ToolDefinition is invariant in its render types; these
// definitions are accepted by createAgentSession's heterogeneous customTools list.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShellToolDefinition = ToolDefinition<any, any, any>;

/** Create Pi Work's bash tool while keeping the server environment private. */
export function createPiWorkBashTool(cwd: string): ShellToolDefinition {
  return createBashToolDefinition(cwd, { spawnHook: privateEnv });
}

/** Create Pi Work's PowerShell tool (Windows only — see the denylist in rpc-manager). */
export function createPiWorkPowerShellTool(cwd: string): ShellToolDefinition {
  return createPowerShellToolDefinition(cwd, { spawnHook: privateEnv });
}
