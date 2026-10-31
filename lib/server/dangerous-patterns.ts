import type { DangerousPatternRule, DangerousPatternsConfig } from "../shared/config-types";
import {
  assembleDangerousRules,
  buildDangerousRuleSetSnapshot,
  matchDangerousCommand,
  type CompiledSourcedDangerousRule,
  type DangerousCommandVerdict,
  type DangerousRuleSetSnapshot,
  type SourcedDangerousCommandMatch,
} from "../shared/dangerous-commands";
import {
  DEFAULT_PERMISSION_MODE,
  isSessionPermissionMode,
  type SessionPermissionMode,
} from "../shared/permission-mode";
import { readConfig, writeConfig } from "./config";
import { createLogger } from "./logger";
import { matchSelfKillCommand } from "./self-protection";

const log = createLogger("dangerous-patterns");

let cachedKey: string | null = null;
let cachedRules: CompiledSourcedDangerousRule[] = [];

function effectiveRules(): CompiledSourcedDangerousRule[] {
  const cfg: DangerousPatternsConfig = readConfig().dangerous_patterns;
  const key = `${process.platform}\u0000${JSON.stringify(cfg.rules)}`;
  if (key === cachedKey) return cachedRules;

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

export function matchDangerousPattern(command: string): SourcedDangerousCommandMatch | null {
  return matchDangerousCommand(command, effectiveRules());
}

export function evaluateDangerousCommand(
  command: string,
  mode: SessionPermissionMode = DEFAULT_PERMISSION_MODE,
): DangerousCommandVerdict {
  const effectiveMode = isSessionPermissionMode(mode) ? mode : DEFAULT_PERMISSION_MODE;
  if (command.trim() === "") return { kind: "none" };

  const selfKill = matchSelfKillCommand(command);
  if (selfKill) return { kind: "self_protected", reason: selfKill.reason };

  if (effectiveMode === "full_access") return { kind: "none" };

  const match = matchDangerousPattern(command);
  if (!match) return { kind: "none" };
  return { kind: "matched", ruleName: match.ruleName, source: match.source };
}

export function getEffectiveDangerousRuleSet(): DangerousRuleSetSnapshot {
  return buildDangerousRuleSetSnapshot(process.platform, readConfig().dangerous_patterns.rules);
}

export function getDangerousPatternTimeoutMs(): number {
  return readConfig().dangerous_patterns.timeout_ms;
}

export function writeDangerousRules(
  rules: readonly DangerousPatternRule[],
  timeoutMs: number | null,
): void {
  const onDisk = readConfig();
  writeConfig({
    ...onDisk,
    dangerous_patterns: {
      rules: [...rules],
      timeout_ms: timeoutMs ?? onDisk.dangerous_patterns.timeout_ms,
    },
  });
}
