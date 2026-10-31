import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { suggestForSession } from "@/lib/server/suggested-prompt";

const log = createLogger("api/sessions/[id]/suggest");

export const dynamic = "force-dynamic";

interface SuggestRequestBody {
  leafId?: unknown;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

async function readBody(req: Request): Promise<SuggestRequestBody> {
  try {
    const parsed = (await req.json()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SuggestRequestBody) : {};
  } catch {
    return {};
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const startedAt = Date.now();
  const body = await readBody(req);

  try {
    const outcome = await suggestForSession({
      sessionId: id,
      leafId: optionalString(body.leafId),
    });

    if (outcome.kind === "none" && outcome.reason === "session-not-found") {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      suggestion: outcome.kind === "suggestion" ? outcome.suggestion : "",
    });
  } catch (error) {
    log.error("suggest failed", { id, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ suggestion: "" });
  }
}
