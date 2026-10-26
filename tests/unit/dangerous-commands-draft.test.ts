import { describe, expect, it } from "vitest";
import {
  DANGEROUS_RULE_TIMEOUT_MAX_MS,
  DANGEROUS_RULE_TIMEOUT_MIN_MS,
  addDangerousRule,
  dangerousRulesDraft,
  dangerousRulesDraftProblem,
  dangerousRulesRequestBody,
  isDangerousRulesDraftDirty,
  moveDangerousRule,
  removeDangerousRule,
  updateDangerousRule,
  validateDangerousRulesWrite,
} from "@/lib/shared/dangerous-commands-draft";
import type { DangerousPatternRule } from "@/lib/shared/config-types";

/**
 * The dangerous-commands page's draft model — the one seam where every
 * "can this be saved?" decision is made. Pure functions, so the error branches
 * (empty name, empty pattern, broken regex) are driven without a server.
 *
 * The page, the editor popup and the write route all read this module: the
 * editor marks the row, the Save button stays disabled, and the route rejects
 * the same payload with a 400. One implementation, three consumers.
 */

const TIMEOUT = 300_000;

const rule = (name: string, pattern: string, ignoreCase?: boolean): DangerousPatternRule => ({
  name,
  pattern,
  ...(ignoreCase ? { ignoreCase } : {}),
});

describe("dangerousRulesDraft", () => {
  it("turns the rules on disk into editable rows, in config order", () => {
    const draft = dangerousRulesDraft([rule("mine", "rm -rf", true), rule("other", "drop")], TIMEOUT);

    expect(draft.timeoutMs).toBe(TIMEOUT);
    expect(draft.rules).toEqual([
      { uid: expect.any(String), name: "mine", pattern: "rm -rf", ignoreCase: true },
      { uid: expect.any(String), name: "other", pattern: "drop", ignoreCase: false },
    ]);
    // Stable ids, distinct per row — the editor and the row marker look rows up
    // by uid, so two rows must never share one.
    expect(new Set(draft.rules.map((entry) => entry.uid)).size).toBe(2);
  });

  it("gives an empty list no rows (the built-in floor is not part of the draft)", () => {
    expect(dangerousRulesDraft([], TIMEOUT).rules).toEqual([]);
  });
});

describe("addDangerousRule", () => {
  it("appends a blank row with a fresh uid and leaves the rest untouched", () => {
    const before = dangerousRulesDraft([rule("mine", "rm -rf")], TIMEOUT);
    const { draft, uid } = addDangerousRule(before);

    expect(draft.rules.map((entry) => entry.uid)).toEqual([before.rules[0].uid, uid]);
    expect(draft.rules[1]).toEqual({ uid, name: "", pattern: "", ignoreCase: false });
    expect(draft.timeoutMs).toBe(TIMEOUT);
  });

  it("adds the row the editor submitted", () => {
    const before = dangerousRulesDraft([rule("mine", "rm -rf")], TIMEOUT);
    const { draft, uid } = addDangerousRule(before, {
      name: "  new-rule  ",
      pattern: "drop\\s+table",
      ignoreCase: true,
    });

    expect(draft.rules[1]).toEqual({
      uid,
      name: "new-rule",
      pattern: "drop\\s+table",
      ignoreCase: true,
    });
  });

  it("keeps uids unique across repeated additions", () => {
    let draft = dangerousRulesDraft([], TIMEOUT);
    const uids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const added = addDangerousRule(draft);
      draft = added.draft;
      uids.push(added.uid);
    }
    expect(new Set(uids).size).toBe(3);
  });
});

describe("dangerousRulesDraftProblem", () => {
  it("reports no problem when every row is complete", () => {
    const draft = dangerousRulesDraft(
      [rule("mine", "rm -rf"), rule("other", "drop\\s+table", true)],
      TIMEOUT,
    );

    expect(dangerousRulesDraftProblem(draft)).toBeNull();
  });

  it("reports an empty name on the row that has it", () => {
    const draft = dangerousRulesDraft([rule("   ", "rm -rf")], TIMEOUT);

    expect(dangerousRulesDraftProblem(draft)).toEqual({ kind: "empty-name", index: 0 });
  });

  it("rejects a pattern that is blank after trimming, because it matches everything", () => {
    const draft = dangerousRulesDraft([rule("mine", "  \t ")], TIMEOUT);

    expect(dangerousRulesDraftProblem(draft)).toEqual({ kind: "empty-pattern", index: 0 });
  });

  it("rejects a pattern that does not compile, with the compiler's reason", () => {
    const draft = dangerousRulesDraft([rule("mine", "(")], TIMEOUT);

    expect(dangerousRulesDraftProblem(draft)).toEqual({
      kind: "invalid-pattern",
      index: 0,
      error: expect.any(String),
    });
  });

  it("reports one problem only, in the fixed order: name, then pattern, then compilation", () => {
    // Row 0 has a broken regex, row 1 has no name: the missing name wins
    // because the criterion order is fixed, not the row order.
    const nameFirst = dangerousRulesDraft([rule("mine", "("), rule("", "ok")], TIMEOUT);
    expect(dangerousRulesDraftProblem(nameFirst)).toEqual({ kind: "empty-name", index: 1 });

    // Row 0 is broken, row 1 has an empty pattern: the empty pattern wins
    // over the compile failure that appears earlier in the list.
    const patternFirst = dangerousRulesDraft([rule("mine", "("), rule("other", " ")], TIMEOUT);
    expect(dangerousRulesDraftProblem(patternFirst)).toEqual({ kind: "empty-pattern", index: 1 });
  });

  it("keeps naming the same problem as the user fixes rows front to back", () => {
    let draft = dangerousRulesDraft([rule("", ""), rule("", "(")], TIMEOUT);
    expect(dangerousRulesDraftProblem(draft)).toEqual({ kind: "empty-name", index: 0 });

    draft = {
      ...draft,
      rules: draft.rules.map((entry, index) =>
        index === 0 ? { ...entry, name: "first" } : entry,
      ),
    };
    expect(dangerousRulesDraftProblem(draft)).toEqual({ kind: "empty-name", index: 1 });
  });

  it("rejects a duplicate name and names the earlier row that already uses it", () => {
    // A name is the key a session's "always allow" remembers, so two rules
    // behind one name would be allowed by a single click (ADR-0020).
    const draft = dangerousRulesDraft([rule("rm", "one"), rule("  rm  ", "two")], TIMEOUT);

    expect(dangerousRulesDraftProblem(draft)).toEqual({
      kind: "duplicate-name",
      index: 1,
      name: "rm",
      conflictIndex: 0,
    });
  });

  it("rejects a name the platform's built-in set reserves", () => {
    const draft = dangerousRulesDraft([rule("mkfs", "x")], TIMEOUT);

    expect(dangerousRulesDraftProblem(draft, { builtinNames: ["rm -rf", "mkfs"] })).toEqual({
      kind: "builtin-name",
      index: 0,
      name: "mkfs",
    });
  });

  it("checks names the row does not hold, because the editor owns one row of a longer list", () => {
    // What the rule editor passes: its own row plus the other rows and their
    // positions, so a duplicate is caught — and located — before the row is
    // even appended.
    const draft = dangerousRulesDraft([rule("taken", "x")], TIMEOUT);

    expect(dangerousRulesDraftProblem(draft, { takenRules: [{ name: "taken", index: 2 }] })).toEqual(
      {
        kind: "duplicate-name",
        index: 0,
        name: "taken",
        conflictIndex: 2,
      },
    );
    expect(dangerousRulesDraftProblem(draft, { takenRules: [{ name: "free", index: 0 }] })).toBeNull();
  });

  it("reports one problem in the fixed order across all criteria", () => {
    const builtins = ["builtin"];
    const cases: Array<{
      rules: DangerousPatternRule[];
      timeoutMs?: number;
      expected: string;
    }> = [
      // empty name wins over everything behind it
      { rules: [rule("", "("), rule("x", "y")], expected: "empty-name" },
      // …including over a duplicate and a built-in collision
      { rules: [rule("", "y"), rule("", "y")], expected: "empty-name" },
      // a duplicate wins over a missing pattern/bad regex further down
      { rules: [rule("dup", "("), rule("dup", " ")], expected: "duplicate-name" },
      // …and over a name that also shadows a built-in
      { rules: [rule("builtin", "a"), rule("builtin", "b")], expected: "duplicate-name" },
      // a built-in collision wins over an empty pattern
      { rules: [rule("builtin", " ")], expected: "builtin-name" },
      // an empty pattern wins over a compile failure that comes earlier
      { rules: [rule("broken", "("), rule("blank", " ")], expected: "empty-pattern" },
      // a broken regex wins over the timeout field
      { rules: [rule("broken", "(")], expected: "invalid-pattern" },
      // the timeout is the last criterion
      { rules: [rule("fine", "x")], timeoutMs: 0, expected: "timeout" },
    ];

    for (const { rules, timeoutMs, expected } of cases) {
      const draft = dangerousRulesDraft(rules, timeoutMs ?? TIMEOUT);
      expect(dangerousRulesDraftProblem(draft, { builtinNames: builtins })?.kind).toBe(expected);
    }
  });

  it("accepts the timeout bounds exactly and refuses everything outside them", () => {
    const at = (timeoutMs: number) =>
      dangerousRulesDraftProblem(dangerousRulesDraft([], timeoutMs))?.kind ?? null;

    expect(at(DANGEROUS_RULE_TIMEOUT_MIN_MS)).toBeNull();
    expect(at(DANGEROUS_RULE_TIMEOUT_MAX_MS)).toBeNull();
    expect(at(TIMEOUT)).toBeNull();
    // Fractions are pointless but harmless; only the range is enforced.
    expect(at(1_500.5)).toBeNull();
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      -1,
      DANGEROUS_RULE_TIMEOUT_MIN_MS - 1,
      DANGEROUS_RULE_TIMEOUT_MAX_MS + 1,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(at(bad)).toBe("timeout");
    }
  });

  it("skips the timeout criterion when the caller owns no timeout field", () => {
    // The editor checks one row; it must not have to invent a timeout value.
    expect(dangerousRulesDraftProblem({ rules: [] })).toBeNull();
    expect(
      dangerousRulesDraftProblem({ rules: [{ uid: "row", name: "mine", pattern: "x", ignoreCase: false }] }),
    ).toBeNull();
  });
});

describe("updateDangerousRule", () => {
  it("replaces the matching row in place and keeps its uid", () => {
    const before = dangerousRulesDraft(
      [rule("first", "one"), rule("second", "two"), rule("third", "three")],
      TIMEOUT,
    );
    const target = before.rules[1];

    const after = updateDangerousRule(before, target.uid, {
      name: "  edited  ",
      pattern: "  two-or-more  ",
      ignoreCase: true,
    });

    // Order and identity are untouched: only the row's content changed, so
    // the row does not jump and the editor's marker stays on it.
    expect(after.rules.map((entry) => entry.uid)).toEqual(before.rules.map((entry) => entry.uid));
    expect(after.rules[1]).toEqual({
      uid: target.uid,
      name: "edited",
      pattern: "  two-or-more  ",
      ignoreCase: true,
    });
    expect(after.rules[0]).toEqual(before.rules[0]);
    expect(after.rules[2]).toEqual(before.rules[2]);
    expect(after.timeoutMs).toBe(TIMEOUT);
  });

  it("does nothing when the uid is gone (a stale editor must not corrupt the list)", () => {
    const before = dangerousRulesDraft([rule("mine", "rm -rf")], TIMEOUT);

    expect(updateDangerousRule(before, "no-such-uid", rule("other", "x"))).toBe(before);
  });

  it("makes the draft dirty", () => {
    const saved = [rule("mine", "rm -rf")];
    const before = dangerousRulesDraft(saved, TIMEOUT);
    const after = updateDangerousRule(before, before.rules[0].uid, rule("mine", "rm -fr"));

    expect(isDangerousRulesDraftDirty(after, saved, TIMEOUT)).toBe(true);
  });
});

describe("removeDangerousRule", () => {
  it("drops the matching row and keeps the others in order", () => {
    const before = dangerousRulesDraft(
      [rule("first", "one"), rule("second", "two"), rule("third", "three")],
      TIMEOUT,
    );

    const after = removeDangerousRule(before, before.rules[1].uid);

    expect(after.rules).toEqual([before.rules[0], before.rules[2]]);
    expect(after.timeoutMs).toBe(TIMEOUT);
  });

  it("does nothing when the uid is gone", () => {
    const before = dangerousRulesDraft([rule("mine", "rm -rf")], TIMEOUT);

    expect(removeDangerousRule(before, "no-such-uid")).toBe(before);
  });

  it("makes the draft dirty", () => {
    const saved = [rule("mine", "rm -rf")];
    const before = dangerousRulesDraft(saved, TIMEOUT);
    const removed = removeDangerousRule(before, before.rules[0].uid);

    expect(removed.rules).toEqual([]);
    expect(isDangerousRulesDraftDirty(removed, saved, TIMEOUT)).toBe(true);
  });
});

describe("moveDangerousRule", () => {
  const three = () =>
    dangerousRulesDraft([rule("first", "one"), rule("second", "two"), rule("third", "three")], TIMEOUT);

  it("swaps a row up with its neighbour", () => {
    const before = three();
    const after = moveDangerousRule(before, before.rules[1].uid, "up");

    expect(after.rules.map((entry) => entry.name)).toEqual(["second", "first", "third"]);
    // Only the two neighbours move: the row keeps its uid, and the untouched
    // row keeps its place at the end.
    expect(after.rules[0]).toEqual(before.rules[1]);
    expect(after.rules[1]).toEqual(before.rules[0]);
    expect(after.rules[2]).toEqual(before.rules[2]);
  });

  it("swaps a row down with its neighbour", () => {
    const before = three();
    const after = moveDangerousRule(before, before.rules[1].uid, "down");

    expect(after.rules.map((entry) => entry.name)).toEqual(["first", "third", "second"]);
    expect(after.rules[2]).toEqual(before.rules[1]);
  });

  it("cannot move the first row up, nor the last row down", () => {
    const before = three();

    expect(moveDangerousRule(before, before.rules[0].uid, "up")).toBe(before);
    expect(moveDangerousRule(before, before.rules[2].uid, "down")).toBe(before);
  });

  it("does nothing for a single row or an unknown uid", () => {
    const single = dangerousRulesDraft([rule("only", "one")], TIMEOUT);
    expect(moveDangerousRule(single, single.rules[0].uid, "up")).toBe(single);
    expect(moveDangerousRule(single, single.rules[0].uid, "down")).toBe(single);
    expect(moveDangerousRule(single, "no-such-uid", "up")).toBe(single);
  });

  it("makes the draft dirty even though the set of rows is unchanged", () => {
    const saved = [rule("first", "one"), rule("second", "two")];
    const before = dangerousRulesDraft(saved, TIMEOUT);
    const after = moveDangerousRule(before, before.rules[1].uid, "up");

    expect(isDangerousRulesDraftDirty(after, saved, TIMEOUT)).toBe(true);
  });
});

describe("dangerousRulesRequestBody", () => {
  it("trims names, omits a false ignoreCase and carries the timeout through", () => {
    const draft = dangerousRulesDraft(
      [rule("  mine  ", "rm -rf", false), rule("other", "drop", true)],
      TIMEOUT,
    );

    expect(dangerousRulesRequestBody(draft)).toEqual({
      rules: [{ name: "mine", pattern: "rm -rf" }, { name: "other", pattern: "drop", ignoreCase: true }],
      timeoutMs: TIMEOUT,
    });
  });

  it("keeps the pattern exactly as written (only surrounding names are normalised)", () => {
    const draft = dangerousRulesDraft([rule("mine", " rm -rf ")], TIMEOUT);

    expect(dangerousRulesRequestBody(draft).rules[0].pattern).toBe(" rm -rf ");
  });
});

describe("isDangerousRulesDraftDirty", () => {
  const saved = [rule("mine", "rm -rf"), rule("other", "drop", true)];

  it("is false for a draft that still matches disk, including ignoreCase: false vs absent", () => {
    const draft = dangerousRulesDraft(saved, TIMEOUT);
    expect(isDangerousRulesDraftDirty(draft, saved, TIMEOUT)).toBe(false);
  });

  it("is true after a row is added", () => {
    const { draft } = addDangerousRule(dangerousRulesDraft(saved, TIMEOUT));
    expect(isDangerousRulesDraftDirty(draft, saved, TIMEOUT)).toBe(true);
  });

  it("is true when only the ignoreCase flag changed", () => {
    const draft = dangerousRulesDraft([rule("mine", "rm -rf", true)], TIMEOUT);
    expect(isDangerousRulesDraftDirty(draft, [rule("mine", "rm -rf")], TIMEOUT)).toBe(true);
  });

  it("is true when the timeout on disk moved under the draft", () => {
    const draft = dangerousRulesDraft(saved, TIMEOUT);
    expect(isDangerousRulesDraftDirty(draft, saved, TIMEOUT + 1)).toBe(true);
  });
});

describe("validateDangerousRulesWrite", () => {
  const body = {
    rules: [{ name: "mine", pattern: "rm -rf", ignoreCase: true }],
    timeoutMs: TIMEOUT,
  };

  it("accepts the request body the page builds", () => {
    expect(validateDangerousRulesWrite(body)).toEqual({ ok: true, ...body });
  });

  it("accepts an empty rule list — that only clears the user's own rules", () => {
    expect(validateDangerousRulesWrite({ rules: [], timeoutMs: TIMEOUT })).toEqual({
      ok: true,
      rules: [],
      timeoutMs: TIMEOUT,
    });
  });

  it("keeps the timeout on disk when the payload does not carry one", () => {
    expect(validateDangerousRulesWrite({ rules: [] })).toEqual({
      ok: true,
      rules: [],
      timeoutMs: null,
    });
  });

  it("rejects a payload that is not an object with a rules array", () => {
    for (const raw of [null, "x", [], {}, { rules: "x" }, { rules: [1] }]) {
      expect(validateDangerousRulesWrite(raw).ok).toBe(false);
    }
  });

  it("rejects non-string name/pattern and a non-boolean ignoreCase", () => {
    const bad = [
      { rules: [{ name: 1, pattern: "x" }] },
      { rules: [{ name: "x", pattern: 1 }] },
      { rules: [{ name: "x", pattern: "x", ignoreCase: "yes" }] },
    ];
    for (const raw of bad) {
      expect(validateDangerousRulesWrite(raw).ok).toBe(false);
    }
  });

  it("rejects the same three blockers the page refuses to submit", () => {
    const emptyName = validateDangerousRulesWrite({ rules: [{ name: " ", pattern: "x" }] });
    const emptyPattern = validateDangerousRulesWrite({ rules: [{ name: "x", pattern: "  " }] });
    const broken = validateDangerousRulesWrite({ rules: [{ name: "x", pattern: "(" }] });

    expect(emptyName.ok).toBe(false);
    expect(emptyPattern.ok).toBe(false);
    expect(broken.ok).toBe(false);
    // The message names the failing rule so the 400 is actionable.
    expect(broken.ok === false && broken.error).toContain("x");
  });

  it("rejects a timeout outside the bounds instead of falling back to the default", () => {
    for (const timeoutMs of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      DANGEROUS_RULE_TIMEOUT_MIN_MS - 1,
      DANGEROUS_RULE_TIMEOUT_MAX_MS + 1,
      "300000",
    ]) {
      const result = validateDangerousRulesWrite({ rules: [], timeoutMs });
      expect(result.ok).toBe(false);
    }
    // The bounds themselves are allowed values.
    for (const timeoutMs of [DANGEROUS_RULE_TIMEOUT_MIN_MS, DANGEROUS_RULE_TIMEOUT_MAX_MS]) {
      expect(validateDangerousRulesWrite({ rules: [], timeoutMs }).ok).toBe(true);
    }
  });

  it("rejects a duplicate name and names the rule that already uses it", () => {
    const result = validateDangerousRulesWrite({
      rules: [
        { name: "twin", pattern: "one" },
        { name: "twin", pattern: "two" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("twin");
    expect(result.ok === false && result.error).toContain("rule 1");
  });

  it("rejects a name the platform's built-in set reserves", () => {
    const result = validateDangerousRulesWrite(
      { rules: [{ name: "mkfs", pattern: "x" }] },
      { builtinNames: ["rm -rf", "mkfs"] },
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("mkfs");
    expect(result.ok === false && result.error).toContain("built-in");
    // Without the platform's names there is nothing to collide with.
    expect(validateDangerousRulesWrite({ rules: [{ name: "mkfs", pattern: "x" }] }).ok).toBe(true);
  });
});
