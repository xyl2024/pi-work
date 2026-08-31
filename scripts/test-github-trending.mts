/**
 * Smoke test for the GitHub Trending feature: scraper, SQLite cache
 * (TTL + refresh), README fetch, and relative-path rewriting.
 *
 * Runs against a TEMP DB (PI_WORK_GITHUB_TRENDING_DB) so real user data
 * under ~/.pi-work is never touched; network calls go to the real GitHub
 * endpoints (needs connectivity).
 *
 * Usage:  npx tsx scripts/test-github-trending.mts
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Override DB path BEFORE importing the db module.
const tmpDir = mkdtempSync(join(tmpdir(), "gt-test-"));
process.env.PI_WORK_GITHUB_TRENDING_DB = join(tmpDir, "test.db");

function log(label: string, value: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`ASSERT FAILED: ${msg}`);
    cleanup();
    process.exit(1);
  }
}

function cleanup() {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ── Pure helpers (no network) ─────────────────────────────────────────────
import { capReadme, rewriteReadmePaths } from "@/lib/server/github-trending/readme";

console.log("\n# 1. rewriteReadmePaths");
const original = [
  "![logo](docs/logo.png)",
  "[usage](../docs/usage.md)",
  "![](./img/1.png)",
  "![ext](https://example.com/a.png)",
  "![data](data:image/png;base64,xxx)",
  "[anchor](#section)",
].join("\n");
const rewritten = rewriteReadmePaths(original, "o/r", "main");
log("rewritten", rewritten);
assert(
  rewritten.includes("](https://raw.githubusercontent.com/o/r/main/docs/logo.png)"),
  "relative image should point at raw.githubusercontent",
);
assert(
  rewritten.includes("](https://github.com/o/r/blob/main/../docs/usage.md)"),
  "relative link should point at the blob path",
);
assert(
  rewritten.includes("](https://raw.githubusercontent.com/o/r/main/img/1.png)"),
  "./ prefix should be stripped",
);
assert(
  rewritten.includes("https://example.com/a.png") && !rewritten.includes("raw.githubusercontent.com/o/r/main/https"),
  "absolute URLs must pass through untouched",
);
assert(rewritten.includes("data:image/png;base64,xxx"), "data URIs untouched");
assert(rewritten.includes("[anchor](#section)"), "anchor links untouched");

console.log("\n# 2. capReadme");
assert(capReadme("short") === "short", "short md unchanged");
const long = "x".repeat(300 * 1024);
assert(capReadme(long).length === 256 * 1024, "long md truncated to 256KB");

// ── Scraper + cache + README (network) ────────────────────────────────────
import { getReadme, getTrending, README_TTL_MS, TRENDING_TTL_MS } from "@/lib/server/github-trending/service";
import { readReadmeCache, readTrendingCache } from "@/lib/server/github-trending/db";

console.log("\n# 3. TTL constants");
// Fixed by design: 60min trending / 24h README (see design doc).
assert(TRENDING_TTL_MS === 60 * 60 * 1000, "trending TTL must be 60min");
assert(README_TTL_MS === 24 * 60 * 60 * 1000, "readme TTL must be 24h");

console.log("\n# 4. getTrending (fresh scrape, lang=all since=daily)");
const first = await getTrending("all", "daily");
assert(first.repos.length > 0, "trending list must not be empty");
const r0 = first.repos[0];
assert(
  typeof r0.fullName === "string" && r0.fullName.includes("/"),
  "first repo must have owner/name",
);
assert(typeof r0.totalStars === "string" && r0.totalStars.length > 0, "totalStars present");
log("first repo", r0);
assert(first.stale === false && first.fetchedAt > 0, "fresh response flags");

console.log("\n# 5. getTrending cache hit (no re-scrape)");
const second = await getTrending("all", "daily");
assert(second.fetchedAt === first.fetchedAt, "second call must reuse the cached row (same fetchedAt)");

console.log("\n# 6. force refresh bypasses cache");
const forced = await getTrending("all", "daily", { refresh: true });
log("forced fetchedAt", forced.fetchedAt);
assert(forced.fetchedAt >= first.fetchedAt, "forced refresh re-fetches");
const dbRow = readTrendingCache("all", "daily");
assert(dbRow !== undefined && dbRow.fetched_at === forced.fetchedAt, "DB row updated on refresh");

console.log("\n# 7. language-filtered scrape");
const goList = await getTrending("go", "daily");
assert(goList.repos.length > 0, "go trending list not empty");
const goRow = readTrendingCache("go", "daily");
assert(goRow !== undefined, "go key cached separately");
log("go count", goList.repos.length);

console.log("\n# 8. README fetch + cache (first repo)");
const readme = await getReadme(r0.fullName);
assert(readme.markdown.length > 0, "readme markdown not empty");
assert(readme.branch.length > 0, "branch resolved");
assert(readme.stale === false, "readme fresh");
log("readme", { fullName: readme.fullName, branch: readme.branch, chars: readme.markdown.length });
const cacheRow = readReadmeCache(r0.fullName);
assert(cacheRow !== undefined && cacheRow.branch === readme.branch, "readme cached with branch");

console.log("\n# 9. README cache hit");
const readme2 = await getReadme(r0.fullName);
assert(readme2.fetchedAt === readme.fetchedAt, "readme served from cache");

console.log("\n# 10. stale fallback (fetch failure after TTL expiry)");
// Age out the cache row past its TTL, then force every fetch to fail:
// getTrending must return the old data with `stale: true` instead of
// throwing.
import { getGithubTrendingDb } from "@/lib/server/github-trending/db";
const gtDb = getGithubTrendingDb();
gtDb
  .prepare("UPDATE trending_cache SET fetched_at = ? WHERE lang = 'all' AND since = 'daily'")
  .run(Date.now() - TRENDING_TTL_MS - 1000);
const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("simulated network failure");
};
try {
  const stale = await getTrending("all", "daily");
  assert(stale.stale === true, "expired + failed refresh must flag stale");
  assert(stale.repos.length > 0, "stale response still carries the old rows");
  log("stale fetchedAt", new Date(stale.fetchedAt).toISOString());
} finally {
  globalThis.fetch = realFetch;
}

console.log("\n# 11. fresh cache hit survives fetch failure");
globalThis.fetch = async () => {
  throw new Error("simulated network failure");
};
try {
  const fresh = await getTrending("go", "daily");
  assert(fresh.stale === false && fresh.repos.length > 0, "fresh row served with no network");
  log("fresh served from cache despite fetch failure", fresh.repos.length);
} finally {
  globalThis.fetch = realFetch;
}

console.log("\n✓ ALL GITHUB TRENDING SMOKE TESTS PASSED");
cleanup();
process.exit(0);