/**
 * Smoke test for the GitHub Trending feature: scraper and SQLite cache
 * (daily scrape + refresh + stale fallback).
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

// ── Scraper + cache (network) ─────────────────────────────────────────────
import { getTrending, isFetchedToday } from "@/lib/server/github-trending/service";
import { readTrendingCache } from "@/lib/server/github-trending/db";

console.log("\n# 1. isFetchedToday (calendar-day freshness)");
const noon = (d: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  dt.setHours(12, 0, 0, 0);
  return dt.getTime();
};
const today = new Date();
assert(isFetchedToday(noon(-1), noon(0)) === false, "yesterday's row must not count as fresh");
assert(isFetchedToday(noon(0), noon(0)) === true, "same-day row counts as fresh");
assert(
  isFetchedToday(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0).getTime(), Date.now()) === true,
  "early-morning same-day row counts as fresh",
);

console.log("\n# 2. getTrending (fresh scrape, lang=all since=daily)");
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

console.log("\n# 3. getTrending cache hit (no re-scrape)");
const second = await getTrending("all", "daily");
assert(second.fetchedAt === first.fetchedAt, "second call must reuse the cached row (same fetchedAt)");

console.log("\n# 4. force refresh bypasses the once-per-day rule");
const forced = await getTrending("all", "daily", { refresh: true });
log("forced fetchedAt", forced.fetchedAt);
assert(forced.fetchedAt >= first.fetchedAt, "forced refresh re-fetches");
const dbRow = readTrendingCache("all", "daily");
assert(dbRow !== undefined && dbRow.fetched_at === forced.fetchedAt, "DB row updated on refresh");

console.log("\n# 5. language-filtered scrape");
const goList = await getTrending("go", "daily");
assert(goList.repos.length > 0, "go trending list not empty");
const goRow = readTrendingCache("go", "daily");
assert(goRow !== undefined, "go key cached separately");
log("go count", goList.repos.length);

console.log("\n# 6. stale fallback (row from a previous day + fetch failure)");
// Age the cache row out to yesterday, then force every fetch to fail:
// getTrending must return the old data with `stale: true` instead of
// throwing.
import { getGithubTrendingDb } from "@/lib/server/github-trending/db";
const gtDb = getGithubTrendingDb();
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
gtDb
  .prepare("UPDATE trending_cache SET fetched_at = ? WHERE lang = 'all' AND since = 'daily'")
  .run(yesterday.getTime());
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

console.log("\n# 7. fresh cache hit survives fetch failure");
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
