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
  await safeBootstrap("scheduler", () => import("@/lib/server/scheduler/startup"));
  await safeBootstrap("kanban",    () => import("@/lib/server/kanban/startup"));
  await safeBootstrap("rss",       () => import("@/lib/server/rss/startup"));
  await safeBootstrap("terminal",  () => import("@/lib/server/terminal/startup"));
}
