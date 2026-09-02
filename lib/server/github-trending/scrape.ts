// ── GitHub Trending: HTML scraper ─────────────────────────────────────────
// Fetches github.com/trending (optionally per-language, per-period) and
// parses the article list with cheerio. The selectors mirror the reference
// Python scraper (get_github_repo_list.py) except where the page's current
// markup demands more precision:
//
//   - total stars: `a[href$="/stargazers"]` (the "div.color-fg-muted a"
//     second-link shortcut in the Python version can grab the forks link
//     instead of the period delta).
//   - period delta: `span.d-inline-block.float-sm-right` ("1,234 stars
//     today").
//
// GitHub has no rate limit on the trending HTML page itself.

import { load, type CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { createLogger } from "@/lib/server/logger";
import type { TrendingRepo, TrendingSince } from "@/lib/shared/github-trending";

const log = createLogger("github-trending/scrape");

const REQUEST_TIMEOUT_MS = 30_000;

// The reference script's headers — a real browser UA keeps GitHub from
// serving a bot-detection page.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
};

function trendingUrl(
  lang: string, // "all" or a language slug
  since: TrendingSince,
): string {
  const base =
    lang === "all"
      ? "https://github.com/trending"
      : `https://github.com/trending/${lang}`;
  return `${base}?since=${since}`;
}

/** Parse one `article.Box-row` into a TrendingRepo. */
function parseRow($: CheerioAPI, item: Element, rank: number): TrendingRepo {
  const anchor = $("h2 a", item);
  const href = anchor.attr("href") ?? "";
  // h2 content is "owner / name" — collapse whitespace/newlines and drop
  // the slash spacing to recover the joined full name.
  const fullName = anchor.text().trim().replace(/\s+/g, "");
  const slash = fullName.indexOf("/");
  const owner = slash > 0 ? fullName.slice(0, slash) : fullName;
  const name = slash > 0 ? fullName.slice(slash + 1) : fullName;

  const description = $("p.col-9", item).text().trim();
  const languageNode = $("span[itemprop='programmingLanguage']", item);
  const language = languageNode.text().trim();

  const starAnchor = $('a[href$="/stargazers"]', item).first();
  const totalStars = starAnchor.text().trim();
  const periodNode = $("span.d-inline-block.float-sm-right", item).first();
  const periodStars = periodNode.text().trim();

  return {
    rank,
    owner,
    name,
    fullName,
    description,
    url: href ? `https://github.com${href}` : "",
    language,
    totalStars,
    periodStars,
  };
}

/**
 * Fetch and parse the trending list for `(lang, since)`. Throws on network
 * errors or non-2xx responses — the caller decides how to fail (fresh
 * refresh vs. stale fallback).
 */
export async function scrapeTrending(
  lang: string,
  since: TrendingSince,
): Promise<TrendingRepo[]> {
  const url = trendingUrl(lang, since);
  const startedAt = Date.now();

  const res = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`trending fetch failed: HTTP ${res.status} for ${url}`);
  }
  const html = await res.text();

  const $ = load(html);
  const items = $("div.Box article.Box-row").toArray();
  const repos = items.map((item, idx) => parseRow($, item, idx + 1));

  log.info("scraped trending", {
    lang,
    since,
    count: repos.length,
    durationMs: Date.now() - startedAt,
  });
  return repos;
}