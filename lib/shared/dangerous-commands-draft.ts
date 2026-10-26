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
 * Exactly one problem is reported at a time, and the criterion order is fixed
 * so the first answer is predictable as rules are added:
 *
 *   empty name → duplicate name → built-in name → empty pattern → compile →
 *   timeout
 *
 * Each criterion is scanned across the whole list before the next one starts,
 * not row by row: fixing the reported row moves on to the next criterion rather
 * than to the same criterion on the next row.
 *
 * Names are not decoration: the confirmation dialog shows them and a session's
 * "always allow" remembers them as its key (ADR-0020), so a duplicate would let
 * one allow cover two rules, and a name that shadows a built-in would make the
 * dialog disagree with the list the user is looking at.
 *
 * ReDoS is deliberately **not** analysed here — no static analysis and no
 * runtime timeout around the match. A command string is almost always under
 * 1 KB, and anyone who can edit these rules can also edit the gate itself, so
 * "an attacker slipped in a malicious pattern" is not in this threat model
 * (ADR-0020). What *is* refused is a pattern that cannot compile at all, or an
 * empty one that compiles into "match everything".
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
 * The page's editable state. `timeoutMs` rides along so a rule-only save never
 * resets it; the page's timeout field writes through this same draft.
 */
export interface DangerousRulesDraft {
  rules: DangerousRuleDraftEntry[];
  timeoutMs: number;
}

/**
 * The single reason a save is blocked.
 *
 * Row-scoped blockers name their row (`index`); the timeout is a page-level
 * value with no row of its own, so it is its own shape instead of a sentinel
 * index that every reader would have to know about.
 */
export type DangerousRuleProblem =
  | {
      kind: "empty-name" | "duplicate-name" | "builtin-name" | "empty-pattern" | "invalid-pattern";
      /** The row the page marks. */
      index: number;
      /** JavaScript's compile error; present only for `invalid-pattern`. */
      error?: string;
      /** The trimmed name that is already taken; present for both name conflicts. */
      name?: string;
      /** The earlier rule already using `name`; absent when the clash is a built-in. */
      conflictIndex?: number;
    }
  | { kind: "timeout" };

/**
 * Names the draft is compared against but does not contain.
 *
 * `builtinNames` is the platform's built-in floor (ADR-0020: a user rule may not
 * shadow it). `takenRules` is how the rule editor asks the same question about
 * one row while the rest of the list lives in the page: the page passes the
 * other rows and their positions, so a duplicate is caught before it is even
 * appended — and the message can still say *which* rule holds the name.
 */
export interface DangerousRulesProblemContext {
  builtinNames?: readonly string[];
  takenRules?: readonly { name: string; index: number }[];
}

/**
 * How long a confirmation waits for an answer.
 *
 * The bounds exist so the page can refuse a value instead of guessing: below a
 * second the prompt is noise nobody can answer, and past a day "wait until
 * tomorrow" is not a timeout. The default stays in `lib/server/config.ts`
 * (5 minutes); this module only owns "is this value acceptable?".
 *
 * The config loader stays lenient, exactly as it is for a hand-edited pattern
 * that does not compile: an out-of-bounds value still loads and is still used,
 * and the page reports it as a blocker until it is fixed. Silently rewriting a
 * value the user typed would hide the problem instead of showing it.
 */
export const DANGEROUS_RULE_TIMEOUT_MIN_MS = 1_000;
export const DANGEROUS_RULE_TIMEOUT_MAX_MS = 24 * 60 * 60 * 1_000;

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

/** An editor result as a row. Names are labels, so they are trimmed once, here. */
function entryFromRule(uid: string, rule: DangerousPatternRule): DangerousRuleDraftEntry {
  return {
    uid,
    name: rule.name.trim(),
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
        initial ? entryFromRule(uid, initial) : { uid, name: "", pattern: "", ignoreCase: false },
      ],
    },
    uid,
  };
}

/**
 * Replace the row `uid` with the editor's result. The row keeps its uid and its
 * position — editing must not reorder the list behind the user's back — and a
 * name is trimmed like {@link addDangerousRule} trims it. An unknown uid is a
 * no-op (and hands back the same draft), so a stale editor cannot append a row
 * to a list that has moved on.
 */
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

/** Drop the row `uid`; the others keep their order and uids. Unknown uid → no change. */
export function removeDangerousRule(draft: DangerousRulesDraft, uid: string): DangerousRulesDraft {
  const rules = draft.rules.filter((entry) => entry.uid !== uid);
  if (rules.length === draft.rules.length) return draft;
  return { ...draft, rules };
}

/**
 * Move the row `uid` one step. This is not decoration: the matcher walks the
 * list in order and the first match wins, so order decides which rule's name a
 * confirmation shows (and therefore which name "always allow" remembers).
 * Moving past either end is a no-op, which is what makes the first row's up
 * button and the last row's down button disabled states rather than errors.
 */
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

/** Compile one pattern; returns the compiler's reason, or null when it compiles. */
function compileError(pattern: string, ignoreCase: boolean): string | null {
  try {
    new RegExp(pattern, ignoreCase ? "i" : "");
    return null;
  } catch (err) {
    return String(err);
  }
}

/** Whether `timeoutMs` is a value the page may save. */
function timeoutAcceptable(timeoutMs: number): boolean {
  // NaN and ±Infinity fail the comparisons, so a single range check is enough.
  return timeoutMs >= DANGEROUS_RULE_TIMEOUT_MIN_MS && timeoutMs <= DANGEROUS_RULE_TIMEOUT_MAX_MS;
}

/**
 * The first row whose trimmed name `taken` holds — the scan the two
 * out-of-list criteria (other rows, built-ins) share. `conflictIndex` is the
 * position `taken` recorded (the rule that already owns the name), or null for
 * a built-in, which has no position in the user's list.
 */
function firstTakenName(
  rules: readonly DangerousRuleDraftEntry[],
  taken: ReadonlyMap<string, number | null> | null,
): { index: number; name: string; conflictIndex: number | null } | null {
  if (!taken || taken.size === 0) return null;
  for (const [index, entry] of rules.entries()) {
    const name = entry.name.trim();
    // A blank name is the earlier criterion's business, not a conflict.
    if (name.length === 0 || !taken.has(name)) continue;
    return { index, name, conflictIndex: taken.get(name) ?? null };
  }
  return null;
}

/**
 * The first row that repeats a name already used earlier in the list. Unlike
 * {@link firstTakenName}, the reported row is the *later* one: that is the row
 * the user has to rename, and the earlier row is what it conflicts with.
 */
function firstDuplicate(
  rules: readonly DangerousRuleDraftEntry[],
): { index: number; name: string; conflictIndex: number } | null {
  const first = new Map<string, number>();
  for (const [index, entry] of rules.entries()) {
    const name = entry.name.trim();
    // A blank name is the earlier criterion's business, not a duplicate.
    if (name.length === 0) continue;
    const earlier = first.get(name);
    if (earlier !== undefined) return { index, name, conflictIndex: earlier };
    first.set(name, index);
  }
  return null;
}

/**
 * The first blocker, or null.
 *
 * Criteria are checked one at a time across the whole list — not row by row —
 * so the reported problem is the same whichever row the user happens to look
 * at first, and fixing it moves to the next criterion in a predictable order.
 *
 * `timeoutMs` is optional: the rule editor checks one row and owns no timeout
 * field, so it must not invent a placeholder value to ask the question. The
 * page and the write route pass the real value and get the timeout criterion.
 */
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
  // Rows the draft does not hold (the editor's "the rest of the list") are the
  // same blocker as an in-list duplicate: one name, two rules.
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
  if (draft.timeoutMs !== undefined && !timeoutAcceptable(draft.timeoutMs)) {
    return { kind: "timeout" };
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
 * which is what a rule-only save does. An out-of-range or non-numeric value is
 * refused rather than silently replaced by the default: the historical
 * hand-edited-YAML fallback is exactly what a UI has to stop doing.
 *
 * `builtinNames` is the platform's built-in floor, which a user rule may not
 * shadow (ADR-0020): the name keys a session's "always allow", so a shadowed
 * name would make one allow cover two rules.
 */
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

  // Same blockers the page refuses to submit, in the same order and with the
  // row number: the timeout criterion is deliberately last (see the module
  // header), so rules are fixed before the scalar field is argued about. A
  // non-numeric timeout becomes NaN here, which the criterion refuses.
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
