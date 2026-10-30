import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import { resolveSessionPath } from "@/lib/server/session-reader";
import { exportSessionHtmlViaPi } from "@/lib/server/session-export/pi-html";
import { createLogger, elapsedMs } from "@/lib/server/logger";

const log = createLogger("api/sessions/[id]/export");

function slugifyTitle(title: string, fallbackId: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N}一-鿿]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : `session-${fallbackId.slice(0, 8)}`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const url = new URL(req.url);
    const leafId = url.searchParams.get("leafId");
    const themeName = url.searchParams.get("theme") ?? undefined;

    log.debug("export session requested", { id, leafId, themeName });

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      log.warn("export session not found", { id, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    const sm = SessionManager.open(filePath);

    const html = await exportSessionHtmlViaPi(sm, {
      leafId,
      themeName,
    });

    const sessionName =
      (typeof sm.getSessionName === "function" ? sm.getSessionName() : "") ?? "";
    const title =
      sessionName.length > 0 ? sessionName : `Session ${id.slice(0, 8)}`;
    const slug = slugifyTitle(title, id);

    log.info("session exported via pi", {
      id, slug, leafId, themeName,
      htmlBytes: html.length,
      durationMs: elapsedMs(startedAt),
    });

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(slug)}.html`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    log.error("export session failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}