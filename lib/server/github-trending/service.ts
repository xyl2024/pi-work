// ── GitHub Trending: business layer (cache + refresh semantics) ───────────
// Owns the TTLs and the stale-fallback rules agreed in design:
//
//   trending list (per lang+since key)
//     fresh   → serve cache, no network
//     expired → synchronously re-scrape & re-write; on failure fall back
//               to the old row and flag `stale: true` so the UI can show
//               a "cached data" banner
//     miss    → scrape, write, serve
//     refresh → force re-scrape regardless of age (UI refresh button)
//
//   README (per full_name)
//     fresh (24h) → serve cache
//     expired/miss → REST fetch; on failure fall back to cache row when
//               one exists (stale flag), else throw
//
// Relative image/link paths are rewritten at fetch time so the persisted
// blob is render-ready.

import { readReadmeCache, readTrendingCache, writeReadmeCache, writeTrendingCache } from "./db";
import { scrapeTrending } from "./scrape";
import { capReadme, fetchReadme, rewriteReadmePaths } from "./readme";
import {
  type ReadmeResponse,
  type TrendingLang,
  type TrendingRepo,
  type TrendingResponse,
  type TrendingSince,
} from "@/lib/shared/github-trending";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("github-trending/service");

/** Trending list TTL. GitHub updates the page roughly daily; 60min fresh
 *  means the typical panel session never re-scrapes, while the data still
 *  turns over within the hour. */
export const TRENDING_TTL_MS = 60 * 60 * 1000;

/** README TTL. READMEs change at week/month granularity; 24h is
 *  deliberately conservative and keeps the unauthenticated REST quota
 *  (60/hr) from ever being a real constraint. */
export const README_TTL_MS = 24 * 60 * 60 * 1000;

function upsertTrending(
  lang: string,
  since: string,
  repos: TrendingRepo[],
  fetchedAt: number,
): void {
  writeTrendingCache(lang, since, JSON.stringify(repos), fetchedAt);
}

/** Load the trending list for (lang, since), applying the TTL/stale
 *  semantics above. Never throws for network failures when a cache row
 *  exists — routes rely on that to serve stale data. */
export async function getTrending(
  lang: TrendingLang,
  since: TrendingSince,
  opts: { refresh?: boolean } = {},
): Promise<TrendingResponse> {
  const force = opts.refresh === true;
  const row = readTrendingCache(lang, since);
  const now = Date.now();

  // Fresh hit (or forced refresh path below already handled) — fast path.
  if (row && !force && now - row.fetched_at < TRENDING_TTL_MS) {
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

/** Load + render-prep a repo's README. `fullName` is validated by the
 *  route before this is reached. */
export async function getReadme(
  fullName: string,
  opts: { refresh?: boolean } = {},
): Promise<ReadmeResponse> {
  const force = opts.refresh === true;
  const row = readReadmeCache(fullName);
  const now = Date.now();

  if (row && !force && now - row.fetched_at < README_TTL_MS) {
    return {
      fullName,
      markdown: row.markdown,
      branch: row.branch,
      stale: false,
      fetchedAt: row.fetched_at,
    };
  }

  try {
    const { markdown, branch } = await fetchReadme(fullName);
    const capped = capReadme(markdown);
    const rewritten = rewriteReadmePaths(capped, fullName, branch);
    writeReadmeCache(fullName, rewritten, branch, now);
    return { fullName, markdown: rewritten, branch, stale: false, fetchedAt: now };
  } catch (error) {
    if (row) {
      log.warn("readme refresh failed; serving stale cache", { fullName, error });
      return {
        fullName,
        markdown: row.markdown,
        branch: row.branch,
        stale: true,
        fetchedAt: row.fetched_at,
      };
    }
    log.error("readme fetch failed (no cached row)", { fullName, error });
    throw error;
  }
}