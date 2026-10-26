import { NextResponse } from "next/server";
import { getEffectiveDangerousRuleSet } from "@/lib/server/dangerous-patterns";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/dangerous-commands");

/**
 * `GET /api/dangerous-commands` — the read side of the dangerous-command
 * config that `GET /api/settings` cannot answer:
 *
 *   • `platform` and `builtins` — the built-in floor is computed from the
 *     server's platform; the client cannot derive the Windows-only PowerShell
 *     set, and must not keep a second copy of the rules;
 *   • `invalidUserRules` — user rules whose pattern does not compile. The
 *     match path skips them (a typo must not take the gate down), but the page
 *     has to show that the rule is not in effect instead of implying it is.
 *
 * The user rules themselves (and `timeout_ms`) come with `GET /api/settings`.
 * Write paths live in their own route for the same reason the read does: this
 * settings item is served as an effective set, not as a config patch.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    const snapshot = getEffectiveDangerousRuleSet();
    log.info("dangerous command rule set read", {
      platform: snapshot.platform,
      builtins: snapshot.builtins.length,
      invalidUserRules: snapshot.invalidUserRules.length,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    log.error("dangerous command rule set read failed", {
      error,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
