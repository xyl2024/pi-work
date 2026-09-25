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
  compileDangerousRules,
  matchDangerousCommand,
  resolveDangerousRules,
  type CompiledDangerousRule,
} from "../shared/dangerous-commands";
import { readConfig } from "./config";
import { createLogger } from "./logger";

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
let cachedRules: CompiledDangerousRule[] = [];

function effectiveRules(): CompiledDangerousRule[] {
  const cfg: DangerousPatternsConfig = readConfig().dangerous_patterns;
  const key = `${process.platform}\u0000${JSON.stringify(cfg.rules)}`;
  if (key === cachedKey) return cachedRules;

  const { compiled, invalid } = compileDangerousRules(resolveDangerousRules(process.platform, cfg.rules));
  for (const rule of invalid) {
    log.warn("invalid dangerous pattern, skipping", { ...rule });
  }
  cachedKey = key;
  cachedRules = compiled;
  return cachedRules;
}

/**
 * Match a command against the dangerous-command rules in force. Returns the
 * rule name of the first match, or null if no rule matched.
 */
export function matchDangerousPattern(command: string): { ruleName: string } | null {
  return matchDangerousCommand(command, effectiveRules());
}

/**
 * Get the configured timeout (ms) for permission requests.
 */
export function getDangerousPatternTimeoutMs(): number {
  return readConfig().dangerous_patterns.timeout_ms;
}
