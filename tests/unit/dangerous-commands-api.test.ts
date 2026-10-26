import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BASH_DANGEROUS_RULES,
  defaultDangerousRules,
} from "@/lib/shared/dangerous-commands";
import {
  DANGEROUS_RULE_TIMEOUT_MAX_MS,
  DANGEROUS_RULE_TIMEOUT_MIN_MS,
} from "@/lib/shared/dangerous-commands-draft";
import type { DangerousPatternRule, DangerousPatternsConfig } from "@/lib/shared/config-types";
import { api, uniqueId, type Json } from "./helpers";

/**
 * `GET /api/dangerous-commands` — the read side of the dangerous-command
 * config: this platform's built-in rule set (what the gate actually enforces)
 * plus the user rules that fail to compile.
 *
 * `PUT` — the page's write face, exercised through the real HTTP path (auth
 * proxy + server) against the isolated instance's `config.yaml`. Policy matches
 * `settings.test.ts`: snapshot the rules on disk, make a reversible change,
 * assert, restore. The invalid-rule half of the GET contract is driven at the
 * route level in `dangerous-commands-route.test.ts`, where a hand-edited config
 * cannot race this file.
 */
describe("dangerous command rule set api", () => {
  it("returns this platform's built-in set, in matching order", async () => {
    const { status, body } = await api("/api/dangerous-commands");
    expect(status).toBe(200);

    expect(body.platform).toBe(process.platform);
    const builtins = body.builtins as DangerousPatternRule[];
    // The isolated instance runs on the same platform as the test process, so
    // the expectation is the platform's real set — not a copy kept in the test.
    expect(builtins).toEqual([...defaultDangerousRules(process.platform)]);
    expect(builtins.map((rule) => rule.name)).toEqual(
      defaultDangerousRules(process.platform).map((rule) => rule.name),
    );
    // Every platform gets the bash floor.
    expect(builtins.map((rule) => rule.name)).toEqual(
      expect.arrayContaining(DEFAULT_BASH_DANGEROUS_RULES.map((rule) => rule.name)),
    );
  });
});

describe("PUT /api/dangerous-commands", () => {
  let original: DangerousPatternsConfig;

  const readRules = async (): Promise<DangerousPatternsConfig> => {
    const { status, body } = await api("/api/settings");
    expect(status).toBe(200);
    return (body as Json).dangerous_patterns as DangerousPatternsConfig;
  };

  const writeRules = (rules: DangerousPatternRule[], timeoutMs: number) =>
    api("/api/dangerous-commands", {
      method: "PUT",
      body: JSON.stringify({ rules, timeoutMs }),
    });

  beforeEach(async () => {
    original = await readRules();
  });

  afterEach(async () => {
    // Leave the isolated instance's config as it was found.
    await writeRules(original.rules, original.timeout_ms);
  });

  it("round-trips rules and timeout through disk, without touching other config", async () => {
    const rules: DangerousPatternRule[] = [
      { name: uniqueId("user-rule"), pattern: "echo\\s+danger" },
      { name: uniqueId("user-rule"), pattern: "drop\\s+database", ignoreCase: true },
    ];

    const put = await writeRules(rules, original.timeout_ms);
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const onDisk = await readRules();
    expect(onDisk.rules).toEqual(rules);
    expect(onDisk.timeout_ms).toBe(original.timeout_ms);

    // The effective-set route agrees: everything the page just saved compiles.
    const snapshot = await api("/api/dangerous-commands");
    expect(snapshot.status).toBe(200);
    expect((snapshot.body as Json).invalidUserRules).toEqual([]);
  });

  it("replaces the whole list, so a cleared list only clears the user's rules", async () => {
    await writeRules([{ name: uniqueId("user-rule"), pattern: "x" }], original.timeout_ms);

    const cleared = await writeRules([], original.timeout_ms);
    expect(cleared.status).toBe(200);

    expect((await readRules()).rules).toEqual([]);
    // The built-in floor is not part of this config item and stays in force.
    const snapshot = await api("/api/dangerous-commands");
    expect((snapshot.body as Json).builtins).toEqual([...defaultDangerousRules(process.platform)]);
  });

  it("takes effect on the next check without a new session", async () => {
    const command = `echo ${uniqueId("rule-hit")}`;
    const ruleName = uniqueId("user-rule");
    const put = await writeRules([{ name: ruleName, pattern: command }], original.timeout_ms);
    expect(put.status).toBe(200);

    // The same server-side judgement a real tool call goes through — no
    // session was created between the write and this check.
    const test = await api("/api/dangerous-commands/test", {
      method: "POST",
      body: JSON.stringify({ command }),
    });
    expect(test.status).toBe(200);
    expect(test.body).toMatchObject({ kind: "matched", ruleName, source: "user" });
  });

  it("edits a rule in place through the same write face", async () => {
    const keep = { name: uniqueId("user-rule"), pattern: "keep-me" };
    const edited = { name: uniqueId("user-rule"), pattern: "before-edit" };
    expect((await writeRules([keep, edited], original.timeout_ms)).status).toBe(200);

    const after = { ...edited, pattern: "after-edit", ignoreCase: true };
    const put = await writeRules([keep, after], original.timeout_ms);
    expect(put.status).toBe(200);

    // Disk holds the edited list in place: same order, other rule untouched.
    expect((await readRules()).rules).toEqual([keep, after]);

    // And the gate now matches the edited pattern under the same rule name.
    const test = await api("/api/dangerous-commands/test", {
      method: "POST",
      body: JSON.stringify({ command: "AFTER-EDIT" }),
    });
    expect(test.body).toMatchObject({ kind: "matched", ruleName: after.name, source: "user" });
  });

  it("deletes one rule through the same write face, leaving the rest in order", async () => {
    const first = { name: uniqueId("user-rule"), pattern: "first-rule" };
    const doomed = { name: uniqueId("user-rule"), pattern: "doomed-rule" };
    const last = { name: uniqueId("user-rule"), pattern: "last-rule" };
    expect((await writeRules([first, doomed, last], original.timeout_ms)).status).toBe(200);

    // The rule is live before the delete, so "gone afterwards" is not just a
    // pattern that never matched anything.
    const before = await api("/api/dangerous-commands/test", {
      method: "POST",
      body: JSON.stringify({ command: "doomed-rule" }),
    });
    expect(before.body).toMatchObject({ kind: "matched", ruleName: doomed.name, source: "user" });

    const put = await writeRules([first, last], original.timeout_ms);
    expect(put.status).toBe(200);
    expect((await readRules()).rules).toEqual([first, last]);

    // The deleted rule is gone from the effective set, so its pattern no
    // longer asks for confirmation.
    const test = await api("/api/dangerous-commands/test", {
      method: "POST",
      body: JSON.stringify({ command: "doomed-rule" }),
    });
    expect(test.body).toEqual({ kind: "none" });
  });

  it("rejects a duplicate name with 400 and leaves disk alone", async () => {
    const before = await readRules();
    const name = uniqueId("twin-rule");

    const put = await writeRules(
      [
        { name, pattern: "one" },
        { name, pattern: "two" },
      ],
      before.timeout_ms,
    );

    expect(put.status).toBe(400);
    // The message names both the clashing rule and the row already using it.
    expect(String(put.body.error)).toContain(name);
    expect(String(put.body.error)).toContain("rule 1");
    expect((await readRules()).rules).toEqual(before.rules);
  });

  it("rejects a name the platform's built-in set reserves, with 400", async () => {
    const before = await readRules();
    // Whatever this platform enforces: shadowing it would make one "always
    // allow" cover two rules, so it is refused rather than renamed.
    const builtinName = defaultDangerousRules(process.platform)[0].name;

    const put = await writeRules([{ name: builtinName, pattern: "x" }], before.timeout_ms);

    expect(put.status).toBe(400);
    expect(String(put.body.error)).toContain(builtinName);
    expect((await readRules()).rules).toEqual(before.rules);
  });

  it("writes a new confirmation timeout and rejects one outside the bounds", async () => {
    const before = await readRules();
    const next = DANGEROUS_RULE_TIMEOUT_MIN_MS + 30_000;

    const saved = await writeRules(before.rules, next);
    expect(saved.status).toBe(200);
    expect((await readRules()).timeout_ms).toBe(next);

    for (const timeoutMs of [
      0,
      -1,
      DANGEROUS_RULE_TIMEOUT_MIN_MS - 1,
      DANGEROUS_RULE_TIMEOUT_MAX_MS + 1,
    ]) {
      const put = await writeRules(before.rules, timeoutMs);
      expect(put.status).toBe(400);
    }

    // A refused timeout is not a silent fallback: disk still holds the value
    // that was just written.
    expect((await readRules()).timeout_ms).toBe(next);
  });

  it("rejects a rule whose pattern does not compile with 400 and leaves disk alone", async () => {
    const name = uniqueId("broken-rule");
    const before = await readRules();

    const put = await writeRules([{ name, pattern: "(" }], before.timeout_ms);
    expect(put.status).toBe(400);
    // The message names the rule, so the rejection is actionable.
    expect(String(put.body.error)).toContain(name);

    expect((await readRules()).rules).toEqual(before.rules);
  });

  it("rejects an empty name or an empty pattern with 400 and leaves disk alone", async () => {
    const before = await readRules();

    for (const rule of [
      { name: "   ", pattern: "ok" },
      { name: "blank-pattern", pattern: "   " },
    ]) {
      const put = await writeRules([rule], before.timeout_ms);
      expect(put.status).toBe(400);
      expect((await readRules()).rules).toEqual(before.rules);
    }
  });

  it("rejects a payload that is not the expected shape", async () => {
    const put = await api("/api/dangerous-commands", {
      method: "PUT",
      body: JSON.stringify({ rules: "not an array" }),
    });
    expect(put.status).toBe(400);
  });
});
