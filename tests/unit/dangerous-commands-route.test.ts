import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDangerousRules, type DangerousRuleSetSnapshot } from "@/lib/shared/dangerous-commands";

/**
 * The `/api/dangerous-commands` read contract, driven at the route level
 * against a temp `PI_WORK_DATA_DIR` (same shape as `config.test.ts`).
 *
 * A user rule that does not compile can only come from a hand-edited
 * `config.yaml` — the write route rejects it before it reaches disk — so this
 * is the one way to exercise the invalid-rule report without mutating the
 * shared isolated instance's config mid-run (`settings.test.ts` snapshots and
 * restores that file in parallel).
 */
const root = mkdtempSync(join(tmpdir(), "pi-work-dangerous-rules-"));

let GET: typeof import("@/app/api/dangerous-commands/route")["GET"];
let readConfig: typeof import("@/lib/server/config")["readConfig"];
let writeConfig: typeof import("@/lib/server/config")["writeConfig"];

beforeAll(async () => {
  process.env.PI_WORK_DATA_DIR = root;
  vi.resetModules();
  ({ GET } = await import("@/app/api/dangerous-commands/route"));
  ({ readConfig, writeConfig } = await import("@/lib/server/config"));
});

beforeEach(() => {
  // The cache lives on globalThis across module evaluations; start each case
  // from the file on disk.
  globalThis.__piWorkConfigCache = undefined;
});

afterAll(() => {
  delete process.env.PI_WORK_DATA_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/dangerous-commands", () => {
  it("reports a user rule that does not compile instead of dropping it", async () => {
    const base = readConfig();
    writeConfig({
      ...base,
      dangerous_patterns: {
        ...base.dangerous_patterns,
        rules: [
          { name: "broken", pattern: "(" },
          { name: "fine", pattern: "fine" },
        ],
      },
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const body = (await response.json()) as DangerousRuleSetSnapshot;
    expect(body.platform).toBe(process.platform);
    // Exactly the built-in layer of the effective set — the same rules the
    // gate matches, not a second copy.
    expect(body.builtins).toEqual([...defaultDangerousRules(process.platform)]);
    expect(body.invalidUserRules).toEqual([{ name: "broken", error: expect.any(String) }]);
  });

  it("reports nothing invalid when every user rule compiles", async () => {
    const base = readConfig();
    writeConfig({
      ...base,
      dangerous_patterns: {
        ...base.dangerous_patterns,
        rules: [{ name: "fine", pattern: "git\\s+status" }],
      },
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const body = (await response.json()) as DangerousRuleSetSnapshot;
    expect(body.invalidUserRules).toEqual([]);
    // User rules are not part of the built-in snapshot; they come with
    // GET /api/settings.
    expect(body.builtins).toEqual([...defaultDangerousRules(process.platform)]);
  });
});
