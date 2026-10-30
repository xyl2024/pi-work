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
  await safeBootstrap("network-proxy", () => import("@/lib/server/network-proxy"));
  await safeBootstrap("allowed-roots", () => import("@/lib/server/file-access-prewarm"));
  await safeBootstrap("scheduler", () => import("@/lib/server/scheduler/startup"));
  await safeBootstrap("subagents", () => import("@/lib/server/subagent-startup"));
  await safeBootstrap("terminal",  () => import("@/lib/server/terminal/startup"));
}
