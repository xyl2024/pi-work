import { NextResponse } from "next/server";
import { defaultDangerousRuleNames } from "@/lib/shared/dangerous-commands";
import { validateDangerousRulesWrite } from "@/lib/shared/dangerous-commands-draft";
import {
  getEffectiveDangerousRuleSet,
  writeDangerousRules,
} from "@/lib/server/dangerous-patterns";
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

/**
 * `PUT /api/dangerous-commands` — write the user's rules (and the timeout) as
 * one config item.
 *
 * This is deliberately **not** part of `PUT /api/settings`: that route's owned
 * keys mean "the client holds the whole config and sends the top-level keys
 * that changed", while this page's subject is the *effective set* the server
 * assembles (platform split, compile results). Same reason `/api/append-system`
 * and `/api/subagents` have their own write faces.
 *
 * Read-modify-write: the body replaces `dangerous_patterns` only, everything
 * else on disk is carried over untouched. Every pattern is compiled before the
 * write — a rejected request leaves `config.yaml` exactly as it was (ADR-0020:
 * with a UI, a rule that silently never matches is worse than a refused save).
 *
 * Names are checked against this platform's built-in set as well: a user rule
 * may not shadow one, because the name keys a session's "always allow" and two
 * rules behind one key means one click allows both.
 */
export async function PUT(req: Request) {
  const startedAt = Date.now();
  try {
    const raw = await req.json().catch(() => undefined);
    const parsed = validateDangerousRulesWrite(raw, {
      builtinNames: defaultDangerousRuleNames(process.platform),
    });
    if (!parsed.ok) {
      log.warn("dangerous command rules rejected", {
        error: parsed.error,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // The route only validates and logs; the read-modify-write of
    // `config.yaml` belongs to the server module that owns this config item.
    writeDangerousRules(parsed.rules, parsed.timeoutMs);
    log.info("dangerous command rules written", {
      rules: parsed.rules.length,
      timeoutMs: parsed.timeoutMs,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("dangerous command rules write failed", {
      error,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
