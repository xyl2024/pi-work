#!/usr/bin/env node
/**
 * Drop the generated route types left behind by the *other* build instances.
 *
 * `tsconfig.json` deliberately includes `.next-test/**` and `.next-isolated/**`
 * (see the test-infrastructure commits) so those instances' generated route
 * validators are type-checked from the main checkout too. Next writes one
 * `RouteHandlerConfig<"/api/...">` entry per route into `types/validator.ts`,
 * so deleting a route leaves a stale entry pointing at a file that no longer
 * exists — and the next `pnpm run build` (or a plain `tsc --noEmit`) fails with
 * `TS2307` until that other instance happens to be rebuilt.
 *
 * Wired as `prebuild`. Deleting a route is the trigger; adding one is not,
 * because a stale validator that is merely missing an entry still compiles.
 *
 * The shared `.next/` is deliberately NOT touched: it is the current build's
 * own output, and a running server may be serving from it.
 *
 * This never fails the build — a cache we cannot clear is not a reason to
 * stop. The directories regenerate the next time their instance runs.
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Build roots that are not the one being built right now. */
const INSTANCES = [".next-test", ".next-isolated"];

/** Every generated-type location tsconfig.json includes. */
const TYPE_DIRS = ["types", "dev/types", "dev/dev/types"];

const cleared = [];

for (const instance of INSTANCES) {
  for (const rel of TYPE_DIRS) {
    const dir = join(repoRoot, instance, rel);
    if (!existsSync(dir)) continue;
    try {
      await rm(dir, { recursive: true, force: true });
      cleared.push(`${instance}/${rel}`);
    } catch {
      // Best effort: a stale cache must never fail a build.
    }
  }
}

if (cleared.length > 0) {
  console.log(`[clean-stale-build-types] cleared ${cleared.join(", ")}`);
}
