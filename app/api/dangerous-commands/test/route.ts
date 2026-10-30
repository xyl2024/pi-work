import { NextResponse } from "next/server";
import { evaluateDangerousCommand } from "@/lib/server/dangerous-patterns";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/dangerous-commands/test");

export async function POST(req: Request) {
  const startedAt = Date.now();
  const body = (await req.json().catch(() => null)) as { command?: unknown } | null;
  const command = body?.command;
  if (typeof command !== "string") {
    return NextResponse.json({ error: "command must be a string" }, { status: 400 });
  }
  const verdict = evaluateDangerousCommand(command);

  try {
    log.info("dangerous command tested", {
      kind: verdict.kind,
      ...(verdict.kind === "matched" ? { ruleName: verdict.ruleName, source: verdict.source } : {}),
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(verdict);
  } catch (error) {
    log.error("dangerous command test failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
