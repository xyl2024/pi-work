import type { DangerousPatternRule } from "./config-types";

function builtinRule(name: string, pattern: RegExp): DangerousPatternRule {
  const unsupported = pattern.flags.replace("i", "");
  if (unsupported) {
    throw new Error(`unsupported regex flags in built-in rule "${name}": ${unsupported}`);
  }
  return {
    name,
    pattern: pattern.source,
    ...(pattern.ignoreCase ? { ignoreCase: true } : {}),
  };
}

export const DEFAULT_BASH_DANGEROUS_RULES: readonly DangerousPatternRule[] = [
  builtinRule(
    "rm -rf",
    /\brm\b(?=[^;|&]*(?:\s-\w*[rR]|\s--recursive\b))(?=[^;|&]*(?:\s-\w*[fF]|\s--force\b))/,
  ),
  builtinRule("mkfs", /\bmkfs(?:\.\w+)?\b/),
  builtinRule("dd to a device", /\bdd\b[^;|&]*\bof=\/dev\//),
  builtinRule("wipefs", /\bwipefs\b/),
  builtinRule("disk partitioning", /\b(?:fdisk|sfdisk|cfdisk|gdisk|parted)\b(?![^;|&]*\s-l\b)/),
  builtinRule(
    "shutdown / reboot",
    /(?:^|[;&|(\n])\s*(?:sudo\s+|doas\s+)*(?:shutdown|reboot|poweroff|halt)\b|\bsystemctl\s+(?:reboot|poweroff|halt)\b/,
  ),
  builtinRule("fork bomb", /:\(\)\s*\{[^}]*\}\s*;?\s*:/),
  builtinRule("chmod -R 777 /", /\bchmod\b[^;|&]*(?:\s-R\b|--recursive\b)[^;|&]*\b777\b[^;|&]*\s\/(?:\s|$)/),
  builtinRule("write to a block device", />\s*\/dev\/(?:sd|hd|vd|nvme|disk|mmcblk)/),
];

export const DEFAULT_POWERSHELL_DANGEROUS_RULES: readonly DangerousPatternRule[] = [
  builtinRule(
    "Remove-Item -Recurse -Force",
    /\b(?:remove-item|ri|rm|del|erase|rd|rmdir)\b(?=[^;|&]*\s-r(?:ecurse)?\b)(?=[^;|&]*\s-fo?(?:rce)?\b)/i,
  ),
  builtinRule("rd /s /q", /\b(?:rd|rmdir|del|erase)\b(?=[^;|&]*\s\/s\b)(?=[^;|&]*\s\/q\b)/i),
  builtinRule(
    "Format-Volume",
    /\b(?:format-volume|clear-disk)\b|\bformat(?:\.com)?\b(?!-)[^;|&]*\s[a-z]:/i,
  ),
  builtinRule("disk partition", /\b(?:new|remove|resize|set)-partition\b|\binitialize-disk\b|\bdiskpart(?:\.exe)?\b/i),
  builtinRule(
    "registry delete",
    /\b(?:remove-item(?:property)?|ri|rm|del|erase|rd|rmdir)\b[^;|&]*\bhk(?:lm|cu|cr|u|cc):|\breg(?:\.exe)?\b\s+delete\b/i,
  ),
  builtinRule("Stop-Computer", /\b(?:stop-computer|restart-computer)\b/i),
];

export function defaultDangerousRules(platform: string): readonly DangerousPatternRule[] {
  return platform === "win32"
    ? [...DEFAULT_BASH_DANGEROUS_RULES, ...DEFAULT_POWERSHELL_DANGEROUS_RULES]
    : [...DEFAULT_BASH_DANGEROUS_RULES];
}

export function defaultDangerousRuleNames(platform: string): string[] {
  return defaultDangerousRules(platform).map((rule) => rule.name);
}

export type DangerousRuleSource = "user" | "builtin";

export interface SourcedDangerousRule extends DangerousPatternRule {
  source: DangerousRuleSource;
}

export type MaybeSourcedDangerousRule = DangerousPatternRule & {
  source?: DangerousRuleSource;
};

export function resolveDangerousRules(
  platform: string,
  userRules: readonly DangerousPatternRule[],
): DangerousPatternRule[] {
  return [...userRules, ...defaultDangerousRules(platform)];
}

export function resolveDangerousRulesWithSource(
  platform: string,
  userRules: readonly DangerousPatternRule[],
): SourcedDangerousRule[] {
  return resolveDangerousRules(platform, userRules).map((rule, index) => ({
    ...rule,
    source: index < userRules.length ? ("user" as const) : ("builtin" as const),
  }));
}

function withoutSource({ name, pattern, ignoreCase }: SourcedDangerousRule): DangerousPatternRule {
  return { name, pattern, ...(ignoreCase ? { ignoreCase } : {}) };
}

export interface CompiledDangerousRule {
  name: string;
  regex: RegExp;
  source?: DangerousRuleSource;
}

export interface CompiledSourcedDangerousRule extends CompiledDangerousRule {
  source: DangerousRuleSource;
}

export interface InvalidDangerousRule {
  name: string;
  pattern: string;
  error: string;
}

export interface DangerousCommandMatch {
  ruleName: string;
  source?: DangerousRuleSource;
}

export interface SourcedDangerousCommandMatch extends DangerousCommandMatch {
  source: DangerousRuleSource;
}

export function compileDangerousRules(
  rules: readonly MaybeSourcedDangerousRule[],
): {
  compiled: CompiledDangerousRule[];
  invalid: InvalidDangerousRule[];
} {
  const compiled: CompiledDangerousRule[] = [];
  const invalid: InvalidDangerousRule[] = [];
  for (const rule of rules) {
    try {
      compiled.push({
        name: rule.name,
        regex: new RegExp(rule.pattern, rule.ignoreCase ? "i" : ""),
        ...(rule.source ? { source: rule.source } : {}),
      });
    } catch (err) {
      invalid.push({ name: rule.name, pattern: rule.pattern, error: String(err) });
    }
  }
  return { compiled, invalid };
}

export function matchDangerousCommand(
  command: string,
  compiled: readonly CompiledSourcedDangerousRule[],
): SourcedDangerousCommandMatch | null;
export function matchDangerousCommand(
  command: string,
  compiled: readonly CompiledDangerousRule[],
): DangerousCommandMatch | null;
export function matchDangerousCommand(
  command: string,
  compiled: readonly CompiledDangerousRule[],
): DangerousCommandMatch | null {
  for (const rule of compiled) {
    if (rule.regex.test(command)) {
      return { ruleName: rule.name, ...(rule.source ? { source: rule.source } : {}) };
    }
  }
  return null;
}

export interface EffectiveDangerousRules {
  rules: SourcedDangerousRule[];
  compiled: CompiledSourcedDangerousRule[];
  invalidUserRules: InvalidDangerousRule[];
}

export function assembleDangerousRules(
  platform: string,
  userRules: readonly DangerousPatternRule[],
): EffectiveDangerousRules {
  const rules = resolveDangerousRulesWithSource(platform, userRules);
  const { compiled, invalid } = compileDangerousRules(rules);
  return {
    rules,
    compiled: compiled.map((rule) => {
      if (!rule.source) throw new Error(`compiled rule "${rule.name}" lost its layer`);
      return { name: rule.name, regex: rule.regex, source: rule.source };
    }),
    invalidUserRules: invalid,
  };
}

export type DangerousCommandVerdict =
  | { kind: "self_protected"; reason: string }
  | { kind: "matched"; ruleName: string; source: DangerousRuleSource }
  | { kind: "none" };

export interface DangerousRuleSetSnapshot {
  platform: string;
  builtins: DangerousPatternRule[];
  invalidUserRules: { name: string; error: string }[];
}

export function buildDangerousRuleSetSnapshot(
  platform: string,
  userRules: readonly DangerousPatternRule[],
): DangerousRuleSetSnapshot {
  const { rules, invalidUserRules } = assembleDangerousRules(platform, userRules);
  return {
    platform,
    builtins: rules.filter((rule) => rule.source === "builtin").map(withoutSource),
    invalidUserRules: invalidUserRules.map(({ name, error }) => ({ name, error })),
  };
}
