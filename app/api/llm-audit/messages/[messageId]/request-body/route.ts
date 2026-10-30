import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getMessageRequestBody } from "@/lib/server/llm-audit-message-body";

const log = createLogger("api/llm-audit-request-body");

export async function GET(req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const startedAt = Date.now();
  try {
    const { messageId } = await params;
    const sessionId = new URL(req.url).searchParams.get("sessionId")?.trim() || null;
    if (!messageId || !sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const body = getMessageRequestBody({ sessionId, messageId });
    if (!body) {
      log.info("no request body captured", { sessionId, messageId, durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "No request body captured for this message" }, { status: 404 });
    }

    log.info("request body downloaded", {
      sessionId,
      messageId,
      bytes: body.content.length,
      durationMs: elapsedMs(startedAt),
    });
    return new NextResponse(body.content, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${body.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    log.error("request body download failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
