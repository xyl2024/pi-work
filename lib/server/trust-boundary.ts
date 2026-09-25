/**
 * Server-side adapter for the trust boundary: hands this process's environment
 * to the pure module in `lib/shared/trust-boundary.ts`.
 *
 * The desktop track is owned by the Electron shell, which mints
 * `PI_WORK_DESKTOP_SECRET` once per launch and passes it here through the
 * environment. `lib/server/env-sanitize.ts` strips every `PI_WORK_*` variable
 * from the processes the agent spawns, so the secret never reaches a command
 * the agent wrote.
 */

import { desktopModeRequested, resolveTerminalHost } from "@/lib/shared/trust-boundary";

/** Whether this process is owned by the desktop shell (`PI_WORK_DESKTOP`). */
export function isDesktopMode(): boolean {
  return desktopModeRequested(process.env);
}

/** The address the terminal WebSocket service binds (see the pure module). */
export function currentTerminalHost(): string {
  return resolveTerminalHost({ desktop: isDesktopMode(), env: process.env });
}
