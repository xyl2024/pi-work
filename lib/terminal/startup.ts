/**
 * Process-startup hook for the WebSocket terminal server.
 *
 * Mirrors `lib/scheduler/startup.ts`: called from `instrumentation.ts` so
 * the terminal WS port is up as soon as the server is ready. Idempotent —
 * the underlying startTerminalServer() is too, so a double call is harmless.
 */

import { startTerminalServer } from "./server";
import { createLogger } from "@/lib/logger";

const log = createLogger("terminal/startup");

let bootstrapped = false;

export function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  startTerminalServer().then(
    () => log.info("terminal bootstrap complete"),
    (err) => log.error("terminal bootstrap failed", { error: err })
  );
}
