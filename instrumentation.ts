/**
 * Next.js server-startup hook. Runs once per server process boot, before
 * any request is served. Used here to start the WeChat inbound monitor
 * so an existing logged-in account is handled even when no one has yet
 * loaded any pi-work page.
 *
 * Next.js picks this file up automatically (no opt-in needed in 16.x).
 *
 * We deliberately avoid importing the full `@/lib/wechat` barrel here
 * — only the startup module. This keeps the dependency surface tiny
 * and avoids any chance of pulling client-bundled code into the server
 * startup path.
 *
 * Each bootstrap is wrapped in try/catch so that a single broken
 * subsystem (typically a missing or ABI-mismatched native module such
 * as node-pty in a slim container image) cannot prevent the rest of
 * the server from coming up. The user will see the failure surfaced
 * when they actually try to use the affected feature.
 */
async function safeBootstrap(
  name: string,
  loader: () => Promise<{ bootstrap: () => void }>,
): Promise<void> {
  try {
    const { bootstrap } = await loader();
    bootstrap();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[instrumentation] ${name} bootstrap failed, continuing without it:`,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await safeBootstrap("wechat",    () => import("@/lib/server/wechat/startup"));
    await safeBootstrap("scheduler", () => import("@/lib/server/scheduler/startup"));
    await safeBootstrap("rss",       () => import("@/lib/server/rss/startup"));
    await safeBootstrap("terminal",  () => import("@/lib/server/terminal/startup"));
  }
}
