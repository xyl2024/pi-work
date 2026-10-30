import { startTerminalServer } from "./server";
import { createLogger } from "@/lib/server/logger";

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
