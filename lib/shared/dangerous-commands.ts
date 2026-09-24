/**
 * The dangerous-command rules Pi Work ships with — the confirmation gate's
 * out-of-the-box safety net — and the pure matcher over them.
 *
 * The gate used to default to *zero* rules, which meant it was off until the
 * user hand-wrote patterns into `config.yaml`. That is a silent downgrade the
 * moment the machine changes: a Windows desktop running the agent's
 * `powershell` tool has no rule that can match a PowerShell command, so the
 * confirmation never appears. Two built-in sets fix that:
 *
 *   • a bash set, enforced on every platform (the agent always has `bash`);
 *   • a PowerShell set, added only on Windows — the one platform where the
 *     agent's `powershell` tool exists (`lib/shared/agent-shell-tools.ts`).
 *
 * The user's own `dangerous_patterns.rules` are checked **first**, so their
 * name wins a tie, but the built-in set stays underneath as a floor rather
 * than being replaced: a user who already curated bash rules must not lose
 * the PowerShell net on Windows (which is exactly the failure this set is for).
 *
 * Rules are heuristics over a command string — shells make provable analysis
 * impossible — so this is a *confirmation* net, not a hard block: a false
 * positive costs one prompt, a false negative costs the filesystem. Patterns
 * are deliberately narrowed to catastrophic operations (recursive forced
 * delete, formatting, partitioning, powering off, a fork bomb) and stay quiet
 * on the read-only forms of the same tools (`fdisk -l`, `Get-Partition`).
 *
 * The platform arrives as an explicit argument — this module never reads
 * `process.platform` (ADR-0003 rule 3), which is what lets the Windows set be
 * unit-tested from Linux.
 */
import type { DangerousPatternRule } from "./config-types";

/** Author a built-in rule from a regex literal, keeping the pattern readable. */
function builtinRule(name: string, pattern: RegExp): DangerousPatternRule {
  // `ignoreCase` is the only flag a rule can carry; anything else would be
  // silently dropped when the source is re-compiled from config.
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

/** Destructive commands the agent's `bash` tool can run on any platform. */
export const DEFAULT_BASH_DANGEROUS_RULES: readonly DangerousPatternRule[] = [
  // Recursive + forced delete, in every flag spelling: `rm -rf`, `rm -fr`,
  // `rm -Rf`, `rm -r -f`, `rm --recursive --force`.
  builtinRule(
    "rm -rf",
    /\brm\b(?=[^;|&]*(?:\s-\w*[rR]|\s--recursive\b))(?=[^;|&]*(?:\s-\w*[fF]|\s--force\b))/,
  ),
  builtinRule("mkfs", /\bmkfs(?:\.\w+)?\b/),
  // Raw writes to a block device. Reading one (`of=/tmp/img`) is not this.
  builtinRule("dd to a device", /\bdd\b[^;|&]*\bof=\/dev\//),
  builtinRule("wipefs", /\bwipefs\b/),
  // Partition editors, minus the read-only listing form (`fdisk -l`).
  builtinRule("disk partitioning", /\b(?:fdisk|sfdisk|cfdisk|gdisk|parted)\b(?![^;|&]*\s-l\b)/),
  builtinRule(
    "shutdown / reboot",
    /(?:^|[;&|(\n])\s*(?:sudo\s+|doas\s+)*(?:shutdown|reboot|poweroff|halt)\b|\bsystemctl\s+(?:reboot|poweroff|halt)\b/,
  ),
  builtinRule("fork bomb", /:\(\)\s*\{[^}]*\}\s*;?\s*:/),
  builtinRule("chmod -R 777 /", /\bchmod\b[^;|&]*(?:\s-R\b|--recursive\b)[^;|&]*\b777\b[^;|&]*\s\/(?:\s|$)/),
  builtinRule("write to a block device", />\s*\/dev\/(?:sd|hd|vd|nvme|disk|mmcblk)/),
];

/**
 * Destructive commands the agent's `powershell` tool can run on Windows.
 * PowerShell is a case-insensitive language, so every rule here matches that
 * way — `remove-item -recurse -force` is the same command as
 * `Remove-Item -Recurse -Force`.
 */
export const DEFAULT_POWERSHELL_DANGEROUS_RULES: readonly DangerousPatternRule[] = [
  // `Remove-Item -Recurse -Force` and its aliases (`rm`/`ri`/`del`/`erase`/
  // `rd`/`rmdir` are all Remove-Item in PowerShell).
  builtinRule(
    "Remove-Item -Recurse -Force",
    /\b(?:remove-item|ri|rm|del|erase|rd|rmdir)\b(?=[^;|&]*\s-r(?:ecurse)?\b)(?=[^;|&]*\s-fo?(?:rce)?\b)/i,
  ),
  // The cmd.exe spelling, which PowerShell runs just as happily.
  builtinRule("rd /s /q", /\b(?:rd|rmdir|del|erase)\b(?=[^;|&]*\s\/s\b)(?=[^;|&]*\s\/q\b)/i),
  // Formatting a volume / wiping a disk. Bare `format` is left out on purpose:
  // `Format-Table` / `Format-List` are everyday output cmdlets, so the
  // cmd.exe form must be the bare token followed by a drive letter.
  builtinRule(
    "Format-Volume",
    /\b(?:format-volume|clear-disk)\b|\bformat(?:\.com)?\b(?!-)[^;|&]*\s[a-z]:/i,
  ),
  builtinRule("disk partition", /\b(?:new|remove|resize|set)-partition\b|\binitialize-disk\b|\bdiskpart(?:\.exe)?\b/i),
  // Deleting a registry key, by hive path or by `reg.exe`. The hive-path form
  // takes the same Remove-Item aliases as the recursive-delete rule above.
  builtinRule(
    "registry delete",
    /\b(?:remove-item(?:property)?|ri|rm|del|erase|rd|rmdir)\b[^;|&]*\bhk(?:lm|cu|cr|u|cc):|\breg(?:\.exe)?\b\s+delete\b/i,
  ),
  builtinRule("Stop-Computer", /\b(?:stop-computer|restart-computer)\b/i),
];

/**
 * The built-in rules `platform` enforces: the bash set everywhere, plus the
 * PowerShell set on the one platform that has the tool.
 */
export function defaultDangerousRules(platform: string): readonly DangerousPatternRule[] {
  return platform === "win32"
    ? [...DEFAULT_BASH_DANGEROUS_RULES, ...DEFAULT_POWERSHELL_DANGEROUS_RULES]
    : [...DEFAULT_BASH_DANGEROUS_RULES];
}

/**
 * The rules actually in force: the user's own rules first, then `platform`'s
 * built-in set. Empty `userRules` (the default config) is not "no gate" — the
 * built-ins are still enforced.
 */
export function resolveDangerousRules(
  platform: string,
  userRules: readonly DangerousPatternRule[],
): DangerousPatternRule[] {
  return [...userRules, ...defaultDangerousRules(platform)];
}

/** A rule whose pattern has been compiled once, ready to match commands. */
export interface CompiledDangerousRule {
  name: string;
  regex: RegExp;
}

/** A rule that could not be compiled — reported, never thrown. */
export interface InvalidDangerousRule {
  name: string;
  pattern: string;
  error: string;
}

/**
 * Compile `rules` for matching. A pattern that does not compile is handed back
 * in `invalid` instead of throwing: a hand-edited `config.yaml` typo must not
 * take the gate — or the turn — down. The caller decides what to do with the
 * report; an invalid rule simply never reaches the matcher.
 */
export function compileDangerousRules(rules: readonly DangerousPatternRule[]): {
  compiled: CompiledDangerousRule[];
  invalid: InvalidDangerousRule[];
} {
  const compiled: CompiledDangerousRule[] = [];
  const invalid: InvalidDangerousRule[] = [];
  for (const rule of rules) {
    try {
      compiled.push({ name: rule.name, regex: new RegExp(rule.pattern, rule.ignoreCase ? "i" : "") });
    } catch (err) {
      invalid.push({ name: rule.name, pattern: rule.pattern, error: String(err) });
    }
  }
  return { compiled, invalid };
}

/**
 * Match a command against compiled `rules`; the first match wins. Pure: no
 * config, no I/O, no logging.
 */
export function matchDangerousCommand(
  command: string,
  compiled: readonly CompiledDangerousRule[],
): { ruleName: string } | null {
  for (const rule of compiled) {
    if (rule.regex.test(command)) return { ruleName: rule.name };
  }
  return null;
}
