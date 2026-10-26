/**
 * The server-side face of the dangerous-command gate: read the user's rules
 * out of `config.yaml`, put this platform's built-in set underneath them
 * (`lib/shared/dangerous-commands.ts`), compile the result, and match a shell
 * command against it. The rule *content*, the matching and the invalid-pattern
 * policy all live in the pure shared module; this file only supplies the
 * config, the platform, and one log line for a broken pattern.
 */
import type { DangerousPatternsConfig } from "../shared/config-types";
import {
  assembleDangerousRules,
  buildDangerousRuleSetSnapshot,
  matchDangerousCommand,
  type CompiledSourcedDangerousRule,
  type DangerousCommandVerdict,
  type DangerousRuleSetSnapshot,
  type SourcedDangerousCommandMatch,
} from "../shared/dangerous-commands";
import { readConfig } from "./config";
import { createLogger } from "./logger";
import { matchSelfKillCommand } from "./self-protection";

const log = createLogger("dangerous-patterns");

/**
 * Compiled rules for the config they came from. `readConfig()` builds a fresh
 * object on every call, so the cache is keyed by the rules' own content (and
 * the platform) rather than by object identity — otherwise it would never hit,
 * as the pre-existing identity-keyed cache never did. Its real job is to keep
 * the "invalid pattern" warning to once per config change instead of once per
 * matched command.
 */
let cachedKey: string | null = null;
let cachedRules: CompiledSourcedDangerousRule[] = [];

function effectiveRules(): CompiledSourcedDangerousRule[] {
  const cfg: DangerousPatternsConfig = readConfig().dangerous_patterns;
  const key = `${process.platform}\u0000${JSON.stringify(cfg.rules)}`;
  if (key === cachedKey) return cachedRules;

  // One assembly for both consumers: the gate matches `compiled`, and the
  // settings page lists the same set (built-ins + layer + invalid rules).
  const { compiled, invalidUserRules } = assembleDangerousRules(
    process.platform,
    cfg.rules,
  );
  for (const rule of invalidUserRules) {
    log.warn("invalid dangerous pattern, skipping", { ...rule });
  }
  cachedKey = key;
  cachedRules = compiled;
  return cachedRules;
}

/**
 * Match a command against the dangerous-command rules in force. Returns the
 * rule name of the first match plus the layer it came from, or null if no rule
 * matched.
 */
export function matchDangerousPattern(command: string): SourcedDangerousCommandMatch | null {
  return matchDangerousCommand(command, effectiveRules());
}

/**
 * The full answer to "what happens if this command runs?": the self-protection
 * hard block first, then the promptable rule match.
 *
 * This is the one place that order is decided. The `tool_call` gate in
 * `lib/server/rpc-manager.ts` and the settings page's command tester both call
 * it, so "the box said it would ask" and "it asked" cannot diverge, and the
 * tester cannot claim a command is fine while the gate hard-blocks it. The
 * self-protection half needs this process's pid and listening port, which is
 * why the verdict is computed here rather than in the browser.
 *
 * Self-protection wins on purpose: its process-kill patterns are POSIX-shaped
 * (`pkill`, `fuser`, `$PPID`) and never match PowerShell syntax, while its
 * system-down ones (`shutdown`, `reboot`) apply to both agent shells — so the
 * check belongs before the match, not inside a per-shell branch.
 */
export function evaluateDangerousCommand(command: string): DangerousCommandVerdict {
  // Nothing to match: an empty command cannot be a dangerous command. (An
  // empty *pattern*, by contrast, compiles and matches everything — which is
  // why the write path refuses one.) The page also skips the request for an
  // empty box; the rule itself lives here so both answers are the same.
  if (command.trim() === "") return { kind: "none" };

  const selfKill = matchSelfKillCommand(command);
  if (selfKill) return { kind: "self_protected", reason: selfKill.reason };

  const match = matchDangerousPattern(command);
  if (!match) return { kind: "none" };
  return { kind: "matched", ruleName: match.ruleName, source: match.source };
}

/**
 * The effective set as the settings page reads it: this platform's built-in
 * rules and the user rules that do not compile. Read fresh from `config.yaml`,
 * so a hand edit shows up as soon as the file changes (the read cache is
 * mtime + size keyed — no session restart).
 */
export function getEffectiveDangerousRuleSet(): DangerousRuleSetSnapshot {
  return buildDangerousRuleSetSnapshot(process.platform, readConfig().dangerous_patterns.rules);
}

/**
 * Get the configured timeout (ms) for permission requests.
 */
export function getDangerousPatternTimeoutMs(): number {
  return readConfig().dangerous_patterns.timeout_ms;
}
