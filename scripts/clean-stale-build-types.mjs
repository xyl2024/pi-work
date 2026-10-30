#!/usr/bin/env node
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const INSTANCES = [".next-test", ".next-isolated"];

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
    }
  }
}

if (cleared.length > 0) {
  console.log(`[clean-stale-build-types] cleared ${cleared.join(", ")}`);
}
