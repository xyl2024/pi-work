import { NextResponse } from "next/server";
import { defaultDangerousRuleNames } from "@/lib/shared/dangerous-commands";
import { validateDangerousRulesWrite } from "@/lib/shared/dangerous-commands-draft";
import {
  getEffectiveDangerousRuleSet,
  writeDangerousRules,
  writeFullAccessByDefault,
} from "@/lib/server/dangerous-patterns";
import { createLogger, elapsedMs } from "@/lib/server/logger";

export const dynamic = "force-dynamic";

const log = createLogger("api/dangerous-commands");

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

export async function PUT(req: Request) {
  const startedAt = Date.now();
  try {
    const raw = await req.json().catch(() => undefined);
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      "fullAccessByDefault" in raw &&
      !("rules" in raw)
    ) {
      const value = (raw as Record<string, unknown>).fullAccessByDefault;
      if (typeof value !== "boolean") {
        log.warn("dangerous command default rejected", {
          reason: "fullAccessByDefault must be a boolean",
          durationMs: elapsedMs(startedAt),
        });
        return NextResponse.json(
          { error: "fullAccessByDefault must be a boolean" },
          { status: 400 },
        );
      }
      writeFullAccessByDefault(value);
      log.info("dangerous command default written", {
        fullAccessByDefault: value,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ success: true, fullAccessByDefault: value });
    }

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
