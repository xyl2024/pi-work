import { describe, expect, it } from "vitest";
import {
  addDangerousRule,
  dangerousRulesDraft,
  dangerousRulesDraftProblem,
  dangerousRulesRequestBody,
  isDangerousRulesDraftDirty,
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

  it("rejects a timeout that is not a finite positive number", () => {
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "300000"]) {
      const result = validateDangerousRulesWrite({ rules: [], timeoutMs });
      expect(result.ok).toBe(false);
    }
  });
});
