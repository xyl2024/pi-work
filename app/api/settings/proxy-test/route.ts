import { NextResponse } from "next/server";
import { checkProxyUrl, probeProxy } from "@/lib/server/network-proxy";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/settings/proxy-test");

/**
 * "Test" button in Settings → Network proxy.
 *
 * Builds a throwaway dispatcher from the *submitted* url / no_proxy (not the
 * saved one) and sends one real request through it, so the user can verify an
 * address before committing it. The live process dispatcher is never touched.
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as {
      url?: unknown;
      no_proxy?: unknown;
      probe_url?: unknown;
    };

    const urlCheck = checkProxyUrl(body.url);
    if (!urlCheck.ok) {
      return NextResponse.json({ error: urlCheck.error }, { status: 400 });
    }
    if (!urlCheck.url) {
      return NextResponse.json(
        { error: "Enter a proxy address first" },
        { status: 400 },
      );
    }

    const noProxy = typeof body.no_proxy === "string" ? body.no_proxy : "";
    const probeUrl = typeof body.probe_url === "string" && body.probe_url.trim()
      ? body.probe_url.trim()
      : undefined;

    const result = await probeProxy(
      { enabled: true, url: urlCheck.url, no_proxy: noProxy },
      probeUrl,
    );

    log.info("proxy probe finished", {
      url: urlCheck.url,
      ok: result.ok,
      status: result.status,
      durationMs: result.durationMs,
    });

    return NextResponse.json(result);
  } catch (error) {
    log.error("proxy probe failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
