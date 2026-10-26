import { NextResponse } from "next/server";
import { evaluateDangerousCommand } from "@/lib/server/dangerous-patterns";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/dangerous-commands/test");

/**
 * `POST /api/dangerous-commands/test` — "if I ran this command, what happens?"
 *
 * Body: `{ command: string }`. Response is one of the three verdicts in
 * `DangerousCommandVerdict`: hard-blocked by self-protection (with the reason),
 * matched by a rule in force (with the rule name and the layer it came from),
 * or no match.
 *
 * The decision is computed server-side, through the same
 * `evaluateDangerousCommand` the `tool_call` gate calls: the self-protection
 * half needs this process's pid and listening port, and a second matcher in
 * the browser would be a second truth about what "matched" means. The user's
 * rule list is read from `config.yaml` on each call, so the tester reflects a
 * hand edit without a restart.
 */
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
