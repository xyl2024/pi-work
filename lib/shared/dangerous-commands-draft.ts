import type { DangerousPatternRule } from "./config-types";

export interface DangerousRuleDraftEntry {
  uid: string;
  name: string;
  pattern: string;
  ignoreCase: boolean;
}

export interface DangerousRulesDraft {
  rules: DangerousRuleDraftEntry[];
  timeoutMs: number;
}

export type DangerousRuleProblem =
  | {
      kind: "empty-name" | "duplicate-name" | "builtin-name" | "empty-pattern" | "invalid-pattern";
      index: number;
      error?: string;
      name?: string;
      conflictIndex?: number;
    }
  | { kind: "timeout" };

export interface DangerousRulesProblemContext {
  builtinNames?: readonly string[];
  takenRules?: readonly { name: string; index: number }[];
}

export const DANGEROUS_RULE_TIMEOUT_MIN_MS = 1_000;
export const DANGEROUS_RULE_TIMEOUT_MAX_MS = 24 * 60 * 60 * 1_000;

export interface DangerousRulesRequestBody {
  rules: DangerousPatternRule[];
  timeoutMs: number;
}

export function dangerousRulesDraft(
  rules: readonly DangerousPatternRule[],
  timeoutMs: number,
): DangerousRulesDraft {
  return {
    rules: rules.map(draftEntry),
    timeoutMs,
  };
}

function draftEntry(rule: DangerousPatternRule, index: number): DangerousRuleDraftEntry {
  return {
    uid: `rule-${index}`,
    name: rule.name,
    pattern: rule.pattern,
    ignoreCase: rule.ignoreCase === true,
  };
}

function entryFromRule(uid: string, rule: DangerousPatternRule): DangerousRuleDraftEntry {
  return {
    uid,
    name: rule.name.trim(),
    pattern: rule.pattern,
    ignoreCase: rule.ignoreCase === true,
  };
}

function nextNewRuleUid(rules: readonly DangerousRuleDraftEntry[]): string {
  const used = new Set(rules.map((entry) => entry.uid));
  let n = rules.length;
  while (used.has(`new-${n}`)) n += 1;
  return `new-${n}`;
}

export function addDangerousRule(
  draft: DangerousRulesDraft,
  initial?: DangerousPatternRule,
): {
  draft: DangerousRulesDraft;
  uid: string;
} {
  const uid = nextNewRuleUid(draft.rules);
  return {
    draft: {
      ...draft,
      rules: [
        ...draft.rules,
        initial ? entryFromRule(uid, initial) : { uid, name: "", pattern: "", ignoreCase: false },
      ],
    },
    uid,
  };
}

export function updateDangerousRule(
  draft: DangerousRulesDraft,
  uid: string,
  rule: DangerousPatternRule,
): DangerousRulesDraft {
  const index = draft.rules.findIndex((entry) => entry.uid === uid);
  if (index === -1) return draft;
  return {
    ...draft,
    rules: draft.rules.map((entry, at) => (at === index ? entryFromRule(uid, rule) : entry)),
  };
}

export function removeDangerousRule(draft: DangerousRulesDraft, uid: string): DangerousRulesDraft {
  const rules = draft.rules.filter((entry) => entry.uid !== uid);
  if (rules.length === draft.rules.length) return draft;
  return { ...draft, rules };
}

export function moveDangerousRule(
  draft: DangerousRulesDraft,
  uid: string,
  direction: "up" | "down",
): DangerousRulesDraft {
  const index = draft.rules.findIndex((entry) => entry.uid === uid);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= draft.rules.length) return draft;
  const rules = [...draft.rules];
  [rules[index], rules[target]] = [rules[target], rules[index]];
  return { ...draft, rules };
}

function compileError(pattern: string, ignoreCase: boolean): string | null {
  try {
    new RegExp(pattern, ignoreCase ? "i" : "");
    return null;
  } catch (err) {
    return String(err);
  }
}

function timeoutAcceptable(timeoutMs: number): boolean {
  return timeoutMs >= DANGEROUS_RULE_TIMEOUT_MIN_MS && timeoutMs <= DANGEROUS_RULE_TIMEOUT_MAX_MS;
}

function firstTakenName(
  rules: readonly DangerousRuleDraftEntry[],
  taken: ReadonlyMap<string, number | null> | null,
): { index: number; name: string; conflictIndex: number | null } | null {
  if (!taken || taken.size === 0) return null;
  for (const [index, entry] of rules.entries()) {
    const name = entry.name.trim();
    if (name.length === 0 || !taken.has(name)) continue;
    return { index, name, conflictIndex: taken.get(name) ?? null };
  }
  return null;
}

function firstDuplicate(
  rules: readonly DangerousRuleDraftEntry[],
): { index: number; name: string; conflictIndex: number } | null {
  const first = new Map<string, number>();
  for (const [index, entry] of rules.entries()) {
    const name = entry.name.trim();
    if (name.length === 0) continue;
    const earlier = first.get(name);
    if (earlier !== undefined) return { index, name, conflictIndex: earlier };
    first.set(name, index);
  }
  return null;
}

export function dangerousRulesDraftProblem(
  draft: { rules: readonly DangerousRuleDraftEntry[]; timeoutMs?: number },
  context: DangerousRulesProblemContext = {},
): DangerousRuleProblem | null {
  for (const [index, entry] of draft.rules.entries()) {
    if (entry.name.trim().length === 0) return { kind: "empty-name", index };
  }
  const duplicate = firstDuplicate(draft.rules);
  if (duplicate) {
    return {
      kind: "duplicate-name",
      index: duplicate.index,
      name: duplicate.name,
      conflictIndex: duplicate.conflictIndex,
    };
  }
  const reUsed = firstTakenName(
    draft.rules,
    context.takenRules
      ? new Map(context.takenRules.map((rule) => [rule.name.trim(), rule.index]))
      : null,
  );
  if (reUsed) {
    return {
      kind: "duplicate-name",
      index: reUsed.index,
      name: reUsed.name,
      ...(reUsed.conflictIndex !== null ? { conflictIndex: reUsed.conflictIndex } : {}),
    };
  }
  const builtin = firstTakenName(
    draft.rules,
    context.builtinNames
      ? new Map(context.builtinNames.map((name) => [name.trim(), null]))
      : null,
  );
  if (builtin) return { kind: "builtin-name", index: builtin.index, name: builtin.name };
  for (const [index, entry] of draft.rules.entries()) {
    if (entry.pattern.trim().length === 0) return { kind: "empty-pattern", index };
  }
  for (const [index, entry] of draft.rules.entries()) {
    const error = compileError(entry.pattern, entry.ignoreCase);
    if (error) return { kind: "invalid-pattern", index, error };
  }
  if (draft.timeoutMs !== undefined && !timeoutAcceptable(draft.timeoutMs)) {
    return { kind: "timeout" };
  }
  return null;
}

export function dangerousRulesRequestBody(draft: DangerousRulesDraft): DangerousRulesRequestBody {
  return {
    rules: draft.rules.map((entry) => ({
      name: entry.name.trim(),
      pattern: entry.pattern,
      ...(entry.ignoreCase ? { ignoreCase: true } : {}),
    })),
    timeoutMs: draft.timeoutMs,
  };
}

function sameRule(a: DangerousPatternRule, b: DangerousPatternRule): boolean {
  return (
    a.name === b.name &&
    a.pattern === b.pattern &&
    (a.ignoreCase === true) === (b.ignoreCase === true)
  );
}

export function isDangerousRulesDraftDirty(
  draft: DangerousRulesDraft,
  savedRules: readonly DangerousPatternRule[],
  savedTimeoutMs: number,
): boolean {
  const saved = dangerousRulesRequestBody(dangerousRulesDraft(savedRules, savedTimeoutMs));
  const next = dangerousRulesRequestBody(draft);
  return (
    next.timeoutMs !== saved.timeoutMs ||
    next.rules.length !== saved.rules.length ||
    next.rules.some((rule, index) => !sameRule(rule, saved.rules[index]))
  );
}

export type DangerousRulesWriteValidation =
  | { ok: true; rules: DangerousPatternRule[]; timeoutMs: number | null }
  | { ok: false; error: string };

export function validateDangerousRulesWrite(
  raw: unknown,
  context: { builtinNames?: readonly string[] } = {},
): DangerousRulesWriteValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be an object" };
  }
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.rules)) {
    return { ok: false, error: "rules must be an array of { name, pattern, ignoreCase? }" };
  }

  const rules: DangerousPatternRule[] = [];
  for (const [index, entry] of body.rules.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `rule ${index + 1} must be an object` };
    }
    const { name, pattern, ignoreCase } = entry as Record<string, unknown>;
    if (typeof name !== "string" || typeof pattern !== "string") {
      return { ok: false, error: `rule ${index + 1} needs a string name and pattern` };
    }
    if (ignoreCase !== undefined && typeof ignoreCase !== "boolean") {
      return { ok: false, error: `rule ${index + 1} has a non-boolean ignoreCase` };
    }
    rules.push({
      name: name.trim(),
      pattern,
      ...(ignoreCase === true ? { ignoreCase: true } : {}),
    });
  }

  const requestedTimeout =
    body.timeoutMs === undefined
      ? undefined
      : typeof body.timeoutMs === "number"
        ? body.timeoutMs
        : Number.NaN;
  const problem = dangerousRulesDraftProblem(
    { rules: rules.map(draftEntry), timeoutMs: requestedTimeout },
    context,
  );
  if (problem) {
    if (problem.kind === "timeout") {
      return {
        ok: false,
        error: `timeoutMs must be a number between ${DANGEROUS_RULE_TIMEOUT_MIN_MS} and ${DANGEROUS_RULE_TIMEOUT_MAX_MS}`,
      };
    }
    const named = `rule ${problem.index + 1}${
      rules[problem.index].name ? ` ("${rules[problem.index].name}")` : ""
    }`;
    if (problem.kind === "empty-name") return { ok: false, error: `${named}: name is required` };
    if (problem.kind === "duplicate-name") {
      return {
        ok: false,
        error:
          problem.conflictIndex === undefined
            ? `${named}: name "${problem.name}" is already used by another rule`
            : `${named}: name "${problem.name}" is already used by rule ${problem.conflictIndex + 1}`,
      };
    }
    if (problem.kind === "builtin-name") {
      return { ok: false, error: `${named}: name "${problem.name}" is reserved by a built-in rule` };
    }
    if (problem.kind === "empty-pattern") {
      return {
        ok: false,
        error: `${named}: pattern is required (an empty pattern matches every command)`,
      };
    }
    return { ok: false, error: `${named}: invalid regular expression: ${problem.error}` };
  }

  return { ok: true, rules, timeoutMs: requestedTimeout ?? null };
}
