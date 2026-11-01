import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import { resolveSessionPath } from "@/lib/server/session-reader";
import { exportSessionHtmlViaPi } from "@/lib/server/session-export/pi-html";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import {
  parseSessionExportFormat,
  sessionExportExtension,
} from "@/lib/shared/session-export";

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
    const format = parseSessionExportFormat(url.searchParams.get("format"));

    log.debug("export session requested", { id, leafId, themeName, format });

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      log.warn("export session not found", { id, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    const sm = SessionManager.open(filePath);

    const sessionName =
      (typeof sm.getSessionName === "function" ? sm.getSessionName() : "") ?? "";
    const title =
      sessionName.length > 0 ? sessionName : `Session ${id.slice(0, 8)}`;
    const slug = slugifyTitle(title, id);
    const extension = sessionExportExtension(format);

    if (format === "jsonl") {
      const body = await readFile(filePath);
      log.info("session exported as jsonl", {
        id, slug, bytes: body.byteLength, durationMs: elapsedMs(startedAt),
      });
      return new NextResponse(new Uint8Array(body), {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(slug)}.${extension}`,
          "Cache-Control": "no-store",
        },
      });
    }

    const html = await exportSessionHtmlViaPi(sm, {
      leafId,
      themeName,
    });

    log.info("session exported via pi", {
      id, slug, leafId, themeName,
      htmlBytes: html.length,
      durationMs: elapsedMs(startedAt),
    });

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(slug)}.${extension}`,
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