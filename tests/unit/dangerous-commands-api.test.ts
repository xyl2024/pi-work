import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASH_DANGEROUS_RULES,
  defaultDangerousRules,
} from "@/lib/shared/dangerous-commands";
import type { DangerousPatternRule } from "@/lib/shared/config-types";
import { api } from "./helpers";

/**
 * `GET /api/dangerous-commands` — the read side of the dangerous-command
 * config: this platform's built-in rule set (what the gate actually enforces)
 * plus the user rules that fail to compile.
 *
 * This file covers the real HTTP path (auth proxy + server). The invalid-rule
 * half of the contract is driven at the route level in
 * `dangerous-commands-route.test.ts`: producing a non-compiling user rule
 * means hand-editing `config.yaml`, which must not race the other tests that
 * snapshot and restore the isolated instance's config.
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
