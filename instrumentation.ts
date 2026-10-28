/**
 * Next.js server-startup hook. Runs once per server process boot, before
 * any request is served. Used here to start the WeChat inbound monitor
 * so an existing logged-in account is handled even when no one has yet
 * loaded any pi-work page.
 *
 * Each bootstrap is isolated so a broken optional subsystem cannot prevent
 * the rest of the server from starting.
 */
async function safeBootstrap(
  name: string,
  loader: () => Promise<{ bootstrap: () => void }>,
): Promise<void> {
  try {
    const { bootstrap } = await loader();
    bootstrap();
  } catch (err) {
    console.warn(
      `[instrumentation] ${name} bootstrap failed, continuing without it:`,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await safeBootstrap("wechat",    () => import("@/lib/server/wechat/startup"));
  // Installs the process-wide outbound proxy dispatcher (a no-op until the
  // user enables it in Settings). Runs before any route module so a request
  // served during boot can never race the first `setGlobalDispatcher` call.
  await safeBootstrap("network-proxy", () => import("@/lib/server/network-proxy"));
  // Warm the allowed-roots cache off the request path (non-blocking, idempotent).
  await safeBootstrap("allowed-roots", () => import("@/lib/server/file-access-prewarm"));
  await safeBootstrap("scheduler", () => import("@/lib/server/scheduler/startup"));
  // Report subagent tasks a previous process left unfinished as interrupted.
  // Runs before any request so a stale `running` row is never served or
  // mistaken for live work; nothing is replayed.
  await safeBootstrap("subagents", () => import("@/lib/server/subagent-startup"));
  await safeBootstrap("terminal",  () => import("@/lib/server/terminal/startup"));
}
