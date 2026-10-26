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
 * The two layers a rule can come from: the user's `config.yaml` list, or the
 * built-in floor underneath it (`lib/shared/dangerous-commands.ts` keeps that
 * floor). The "try a command" result reports which layer fired so the settings
 * page can point at the right list.
 */
export type DangerousRuleSource = "user" | "builtin";

/** A rule together with the layer it came from. */
export interface SourcedDangerousRule extends DangerousPatternRule {
  source: DangerousRuleSource;
}

/** A rule that may or may not remember the layer it came from. */
export type MaybeSourcedDangerousRule = DangerousPatternRule & {
  source?: DangerousRuleSource;
};

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

/**
 * {@link resolveDangerousRules}, but every entry remembers which layer it came
 * from. Same content and order — it *is* the same merge, annotated — so the
 * gate and the settings page cannot drift about what is in force. The layer is
 * what the page's "try a command" answer reports ("your rule" vs "built-in
 * rule").
 */
export function resolveDangerousRulesWithSource(
  platform: string,
  userRules: readonly DangerousPatternRule[],
): SourcedDangerousRule[] {
  return resolveDangerousRules(platform, userRules).map((rule, index) => ({
    ...rule,
    source: index < userRules.length ? ("user" as const) : ("builtin" as const),
  }));
}

/** Drop the provenance, leaving the config-shaped rule. */
function withoutSource({ name, pattern, ignoreCase }: SourcedDangerousRule): DangerousPatternRule {
  return { name, pattern, ...(ignoreCase ? { ignoreCase } : {}) };
}

/** A rule whose pattern has been compiled once, ready to match commands. */
export interface CompiledDangerousRule {
  name: string;
  regex: RegExp;
  /** Set when the rule came from {@link resolveDangerousRulesWithSource}. */
  source?: DangerousRuleSource;
}

/**
 * A compiled rule that knows its layer: what the effective set contains, and
 * what the gate matches. The layer is never optional here, so a verdict can
 * name the list the rule came from instead of guessing one.
 */
export interface CompiledSourcedDangerousRule extends CompiledDangerousRule {
  source: DangerousRuleSource;
}

/** A rule that could not be compiled — reported, never thrown. */
export interface InvalidDangerousRule {
  name: string;
  pattern: string;
  error: string;
}

/** A compiled rule that matched, plus the layer it came from when known. */
export interface DangerousCommandMatch {
  ruleName: string;
  source?: DangerousRuleSource;
}

/** A match that knows its layer — what a match against the effective set gives. */
export interface SourcedDangerousCommandMatch extends DangerousCommandMatch {
  source: DangerousRuleSource;
}

/**
 * Compile `rules` for matching. A pattern that does not compile is handed back
 * in `invalid` instead of throwing: a hand-edited `config.yaml` typo must not
 * take the gate — or the turn — down. The caller decides what to do with the
 * report; an invalid rule simply never reaches the matcher.
 */
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

/**
 * Match a command against compiled `rules`; the first match wins. Pure: no
 * config, no I/O, no logging. `source` is only present when the rules were
 * assembled with provenance (the settings page's view of the effective set).
 *
 * The overload keeps that provenance in the type: matching the effective set
 * (`CompiledSourcedDangerousRule[]`) yields a match whose layer is known, while
 * matching a bare rule list keeps the layer optional.
 */
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

/**
 * The effective rule set, resolved and compiled once:
 *
 *   • `rules` — user rules first, then the platform's built-ins, each tagged
 *     with its layer;
 *   • `compiled` — the matcher's input (invalid patterns are absent);
 *   • `invalidUserRules` — the user rules that failed to compile.
 *
 * The gate and the settings page both read the set through this one function,
 * so "what the page lists" and "what the gate matches" cannot be two answers.
 */
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
    // Narrow the shared compiler's optional layer: every rule here came from
    // `resolveDangerousRulesWithSource`, so its layer is always known. Checked
    // rather than asserted — a future unsourced path fails here, once, instead
    // of putting a guessed layer in front of the user.
    compiled: compiled.map((rule) => {
      if (!rule.source) throw new Error(`compiled rule "${rule.name}" lost its layer`);
      return { name: rule.name, regex: rule.regex, source: rule.source };
    }),
    invalidUserRules: invalid,
  };
}

/**
 * What would happen to a command if it ran now — the answer the settings
 * page's "try a command" box shows. Three cases, because the gate has three:
 *
 *   • `self_protected` — the code-level hard block in
 *     `lib/server/self-protection.ts` would refuse the command outright. Not
 *     configurable, and it wins over a rule match exactly as it does in the
 *     `tool_call` gate (`evaluateDangerousCommand` runs the same check first);
 *   • `matched` — a rule in force would ask the user for confirmation. `source`
 *     says which layer fired, so the page can point at the right list;
 *   • `none` — neither, so the command would run.
 */
export type DangerousCommandVerdict =
  | { kind: "self_protected"; reason: string }
  | { kind: "matched"; ruleName: string; source: DangerousRuleSource }
  | { kind: "none" };

/**
 * The read side of the dangerous-command config, as the settings page shows it:
 * the platform's built-in floor and the user rules that do not compile.
 *
 * A broken user rule is reported here instead of being dropped at match time:
 * a hand edit used to leave nothing but a server log line, which read as "the
 * rule is active" while it never matched anything.
 */
export interface DangerousRuleSetSnapshot {
  platform: string;
  /** The built-in floor, in matching order. Read-only in the page. */
  builtins: DangerousPatternRule[];
  /** User rules that failed to compile, in config order. */
  invalidUserRules: { name: string; error: string }[];
}

export function buildDangerousRuleSetSnapshot(
  platform: string,
  userRules: readonly DangerousPatternRule[],
): DangerousRuleSetSnapshot {
  const { rules, invalidUserRules } = assembleDangerousRules(platform, userRules);
  return {
    platform,
    // Exactly the built-in layer of the set the gate matches — not a second
    // call to `defaultDangerousRules` that could drift from it.
    builtins: rules.filter((rule) => rule.source === "builtin").map(withoutSource),
    invalidUserRules: invalidUserRules.map(({ name, error }) => ({ name, error })),
  };
}
