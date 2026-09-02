// ── GitHub Trending: business layer (cache + refresh semantics) ───────────
// Owns the daily-scrape rule and the stale-fallback rules agreed in design:
//
//   trending list (per lang+since key)
//     fresh   → row fetched on today's calendar date: serve cache, no
//               network — at most one scrape per day, ever
//     expired → row is from a previous day: synchronously re-scrape &
//               re-write; on failure fall back to the old row and flag
//               `stale: true` so the UI can show a "cached data" banner
//     miss    → scrape, write, serve
//     refresh → force re-scrape regardless of age (UI refresh button,
//               the explicit user override)

import { readTrendingCache, writeTrendingCache } from "./db";
import { scrapeTrending } from "./scrape";
import {
  type TrendingLang,
  type TrendingRepo,
  type TrendingResponse,
  type TrendingSince,
} from "@/lib/shared/github-trending";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("github-trending/service");

/** A cache row fetched on today's calendar date counts as fresh — the
 *  trending list is scraped at most once per day; only a new day (or the
 *  explicit refresh button) triggers a re-scrape. */
export function isFetchedToday(fetchedAt: number, now: number): boolean {
  const a = new Date(fetchedAt);
  const b = new Date(now);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function upsertTrending(
  lang: string,
  since: string,
  repos: TrendingRepo[],
  fetchedAt: number,
): void {
  writeTrendingCache(lang, since, JSON.stringify(repos), fetchedAt);
}

/** Load the trending list for (lang, since), applying the daily-scrape /
 *  stale semantics above. Never throws for network failures when a cache
 *  row exists — routes rely on that to serve stale data. */
export async function getTrending(
  lang: TrendingLang,
  since: TrendingSince,
  opts: { refresh?: boolean } = {},
): Promise<TrendingResponse> {
  const force = opts.refresh === true;
  const row = readTrendingCache(lang, since);
  const now = Date.now();

  // Fresh hit (row fetched today) — fast path, no network. A forced
  // refresh bypasses this deliberately (UI refresh button).
  if (row && !force && isFetchedToday(row.fetched_at, now)) {
    return {
      repos: JSON.parse(row.data) as TrendingRepo[],
      stale: false,
      fetchedAt: row.fetched_at,
      lang,
      since,
    };
  }

  try {
    const repos = await scrapeTrending(lang, since);
    upsertTrending(lang, since, repos, now);
    return { repos, stale: false, fetchedAt: now, lang, since };
  } catch (error) {
    if (row) {
      // Expired/stale cache row beats an empty error page.
      log.warn("trending refresh failed; serving stale cache", {
        lang,
        since,
        error,
      });
      return {
        repos: JSON.parse(row.data) as TrendingRepo[],
        stale: true,
        fetchedAt: row.fetched_at,
        lang,
        since,
      };
    }
    // No cache and the network failed — propagate so the route 5xxs and
    // the UI shows the error card.
    log.error("trending fetch failed (no cached row)", { lang, since, error });
    throw error;
  }
}
