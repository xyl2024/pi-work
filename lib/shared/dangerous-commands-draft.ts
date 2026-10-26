/**
 * The dangerous-commands page's draft model: what the user has typed but not
 * yet saved, the one reason a save is blocked, and the request body the write
 * route receives.
 *
 * The whole decision surface is pure — no React, no DOM, no server — so every
 * error branch can be driven from `tests/unit` without starting a server. Three
 * consumers read it and cannot drift:
 *
 *   • the rule editor (add / update) checks one row;
 *   • the page disables Save on {@link dangerousRulesDraftProblem} and sends
 *     {@link dangerousRulesRequestBody};
 *   • the write route re-runs {@link validateDangerousRulesWrite} before it
 *     touches disk, so a hand-crafted request cannot store a rule the page
 *     would have refused.
 *
 * This slice validates three things only: the name must not be blank, the
 * pattern must not be blank after trimming, and the pattern must compile.
 * Duplicate names, built-in name collisions and the timeout bounds arrive with
 * their own tickets; the criterion order below is the one they extend
 * (`name → duplicates → built-in collision → pattern → compile → timeout`), so
 * the first reported problem stays predictable as rules are added.
 *
 * ReDoS is deliberately **not** analysed: a command string is almost always
 * under 1 KB, and anyone who can edit these rules can also edit the gate
 * itself, so "a malicious pattern" is not in this threat model (ADR-0020).
 */
import type { DangerousPatternRule } from "./config-types";

/** One editable row. `uid` is the page's identity for the row, not config. */
export interface DangerousRuleDraftEntry {
  uid: string;
  name: string;
  pattern: string;
  ignoreCase: boolean;
}

/**
 * The page's editable state. `timeoutMs` is carried, untouched, so saving rules
 * never resets a timeout the user set elsewhere (the timeout editor is its own
 * ticket).
 */
export interface DangerousRulesDraft {
  rules: DangerousRuleDraftEntry[];
  timeoutMs: number;
}

/** The three blockers this slice implements. */
export type DangerousRuleProblemKind = "empty-name" | "empty-pattern" | "invalid-pattern";

/**
 * The single reason a save is blocked. `index` points at `draft.rules`, which
 * is what the page marks; other blockers (duplicates, collisions, timeout) will
 * carry their own fields.
 */
export interface DangerousRuleProblem {
  kind: DangerousRuleProblemKind;
  index: number;
  /** JavaScript's compile error; present only for `invalid-pattern`. */
  error?: string;
}

/** The PUT body for this config item. */
export interface DangerousRulesRequestBody {
  rules: DangerousPatternRule[];
  timeoutMs: number;
}

/** Server state → editable draft. */
export function dangerousRulesDraft(
  rules: readonly DangerousPatternRule[],
  timeoutMs: number,
): DangerousRulesDraft {
  return {
    rules: rules.map(draftEntry),
    timeoutMs,
  };
}

/** One row from a config rule. The index is the row's identity on disk. */
function draftEntry(rule: DangerousPatternRule, index: number): DangerousRuleDraftEntry {
  return {
    uid: `rule-${index}`,
    name: rule.name,
    pattern: rule.pattern,
    ignoreCase: rule.ignoreCase === true,
  };
}

/** A uid no row in `rules` uses, so a re-added row cannot collide with a kept one. */
function nextNewRuleUid(rules: readonly DangerousRuleDraftEntry[]): string {
  const used = new Set(rules.map((entry) => entry.uid));
  let n = rules.length;
  while (used.has(`new-${n}`)) n += 1;
  return `new-${n}`;
}

/**
 * Append a row (the "new rule" action) and hand back its uid. `initial` is the
 * editor's result; the name is a label, so it is trimmed the same way the
 * request body trims it, while the pattern stays exactly as typed.
 */
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
        {
          uid,
          name: initial?.name.trim() ?? "",
          pattern: initial?.pattern ?? "",
          ignoreCase: initial?.ignoreCase === true,
        },
      ],
    },
    uid,
  };
}

/** Compile one pattern; returns the compiler's reason, or null when it compiles. */
function compileError(pattern: string, ignoreCase: boolean): string | null {
  try {
    new RegExp(pattern, ignoreCase ? "i" : "");
    return null;
  } catch (err) {
    return String(err);
  }
}

/**
 * The first blocker, or null. Criteria are checked one at a time across the
 * whole list — not row by row — so the reported problem is the same whichever
 * row the user happens to look at first, and fixing it moves to the next
 * criterion in a predictable order.
 *
 * Takes just the rows, not the whole draft: this slice has no timeout
 * criterion, and callers (the editor, the write route) must not invent a
 * placeholder timeout to ask the question.
 */
export function dangerousRulesDraftProblem(draft: {
  rules: readonly DangerousRuleDraftEntry[];
}): DangerousRuleProblem | null {
  for (const [index, entry] of draft.rules.entries()) {
    if (entry.name.trim().length === 0) return { kind: "empty-name", index };
  }
  // `new RegExp("")` compiles and matches everything: a blank pattern would
  // turn the net into "confirm every command", which is not a pattern anyone
  // means to write.
  for (const [index, entry] of draft.rules.entries()) {
    if (entry.pattern.trim().length === 0) return { kind: "empty-pattern", index };
  }
  for (const [index, entry] of draft.rules.entries()) {
    const error = compileError(entry.pattern, entry.ignoreCase);
    if (error) return { kind: "invalid-pattern", index, error };
  }
  return null;
}

/**
 * Draft → PUT body. Names are labels (the confirmation dialog shows them, and
 * they key the session's "always allow"), so they are trimmed; the pattern is
 * kept exactly as written, because rewriting it would silently change what it
 * matches.
 */
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

/** Whether this draft would write anything at all. */
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

/** The write route's verdict on a PUT body. */
export type DangerousRulesWriteValidation =
  | { ok: true; rules: DangerousPatternRule[]; timeoutMs: number | null }
  | { ok: false; error: string };

/**
 * Validate a PUT payload before it reaches disk.
 *
 * `timeoutMs` is optional here — `null` means "leave the value on disk alone",
 * which is what a rule-only save does. Bounds and the UI for it belong to the
 * timeout ticket; a value that is not a finite positive number is still refused
 * rather than silently replaced by the default (the historical hand-edited-YAML
 * behaviour is exactly what a UI has to stop doing).
 */
export function validateDangerousRulesWrite(raw: unknown): DangerousRulesWriteValidation {
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

  let timeoutMs: number | null = null;
  if (body.timeoutMs !== undefined) {
    if (
      typeof body.timeoutMs !== "number" ||
      !Number.isFinite(body.timeoutMs) ||
      body.timeoutMs <= 0
    ) {
      return { ok: false, error: "timeoutMs must be a finite positive number" };
    }
    timeoutMs = body.timeoutMs;
  }

  // Same blockers the page refuses to submit, reported with the row number.
  const problem = dangerousRulesDraftProblem({ rules: rules.map(draftEntry) });
  if (problem) {
    const named = `rule ${problem.index + 1}${rules[problem.index].name ? ` ("${rules[problem.index].name}")` : ""}`;
    if (problem.kind === "empty-name") return { ok: false, error: `${named}: name is required` };
    if (problem.kind === "empty-pattern") {
      return {
        ok: false,
        error: `${named}: pattern is required (an empty pattern matches every command)`,
      };
    }
    return { ok: false, error: `${named}: invalid regular expression: ${problem.error}` };
  }

  return { ok: true, rules, timeoutMs };
}
