import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { sanitizeChildEnv } from "@/lib/server/env-sanitize";

/** Create Pi Work's bash tool while keeping the server environment private. */
// The SDK's generic ToolDefinition is invariant in its render types; this
// definition is accepted by createAgentSession's heterogeneous customTools list.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPiWorkBashTool(cwd: string): ToolDefinition<any, any, any> {
  return createBashToolDefinition(cwd, {
    spawnHook: (context) => ({
      ...context,
      env: sanitizeChildEnv(context.env),
    }),
  });
}
