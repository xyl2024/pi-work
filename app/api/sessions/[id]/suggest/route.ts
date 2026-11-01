import { NextResponse } from "next/server";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { getRpcSession } from "@/lib/server/rpc-manager";
import { ensureSuggestionForCurrentLeaf } from "@/lib/server/suggested-prompt-background";
import { resolveSessionLeafId } from "@/lib/server/suggested-prompt";
import { readStoredSuggestionStatus } from "@/lib/shared/suggested-prompt";
import { readSuggestions } from "@/lib/server/suggested-prompt-store";

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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const requested = optionalString(new URL(req.url).searchParams.get("leafId"));
  const leafId = requested ?? (await resolveSessionLeafId(id));
  if (!leafId) return NextResponse.json({ suggestion: "", leafId: null });

  const stored = readStoredSuggestionStatus(readSuggestions(id), leafId, Date.now());
  return NextResponse.json({
    suggestion: stored.kind === "suggestion" ? stored.text : "",
    leafId,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const startedAt = Date.now();
  const body = await readBody(req);
  const requestedLeafId = optionalString(body.leafId);

  try {
    const outcome = await ensureSuggestionForCurrentLeaf(id, {
      leafId: requestedLeafId,
      onSuggestion: (publication) => getRpcSession(id)?.emitSuggestion(publication),
    });

    if (outcome?.kind === "none" && outcome.reason === "session-not-found") {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const matchesRequestedLeaf =
      outcome?.kind === "suggestion" &&
      (requestedLeafId === null || outcome.leafId === requestedLeafId);

    return NextResponse.json({
      suggestion: matchesRequestedLeaf ? outcome.suggestion : "",
    });
  } catch (error) {
    log.error("suggest failed", { id, error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ suggestion: "" });
  }
}
