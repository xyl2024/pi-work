// ── GitHub Trending panel: shared types + static tables ────────────────────
// Client-safe (no fs / Node API / pi SDK). The server scrapes
// github.com/trending (HTML) and transforms it into `TrendingRepo`; the
// panel renders those rows. `HOT_TRENDING_LANGUAGES` drives the language
// dropdown — a curated subset of the ~800 slugs github.com/trending
// accepts (kept out of the bundle on purpose; "All" covers the rest).

// Time range the trending page accepts. Mirrors the official
// `?since=daily|weekly|monthly` query.
export type TrendingSince = "daily" | "weekly" | "monthly";

export const TRENDING_SINCES: readonly TrendingSince[] = [
  "daily",
  "weekly",
  "monthly",
] as const;

/** Sentinel for the unfiltered list (`/trending` with no language slug). */
export const ALL_LANGUAGES = "all" as const;

/** Slug → official display name, curated from the trending page's own
 *  language list. The slug is the URL segment github.com/trending/<slug>
 *  accepts (note the URL-encoded `c%23` for C#). */
export const HOT_TRENDING_LANGUAGES: Readonly<Record<string, string>> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  go: "Go",
  rust: "Rust",
  java: "Java",
  "c++": "C++",
  "c%23": "C#",
  php: "PHP",
  ruby: "Ruby",
  shell: "Shell",
  swift: "Swift",
  kotlin: "Kotlin",
  dart: "Dart",
  vue: "Vue",
  zig: "Zig",
} as const;

/** Language slug accepted by the trending URL. "all" means no filter. */
export type TrendingLang = "all" | keyof typeof HOT_TRENDING_LANGUAGES;

export function isTrendingSince(v: unknown): v is TrendingSince {
  return v === "daily" || v === "weekly" || v === "monthly";
}

export function isTrendingLang(v: unknown): v is TrendingLang {
  return v === "all" || (typeof v === "string" && v in HOT_TRENDING_LANGUAGES);
}

/** One row of the trending list, mirroring the reference Python scraper's
 *  Repo dataclass. Star figures keep the official page's raw text
 *  ("34.5k", "1,234 stars today") — no reformatting, no i18n. */
export interface TrendingRepo {
  rank: number;
  owner: string;
  name: string;
  fullName: string;
  description: string;
  url: string;
  language: string;
  totalStars: string;
  periodStars: string;
}

/** Shape of the trending-list API response. `stale` marks data served from
 *  an expired cache row after a refresh attempt failed. */
export interface TrendingResponse {
  repos: TrendingRepo[];
  stale: boolean;
  fetchedAt: number; // epoch ms of the data's last successful fetch
  lang: TrendingLang;
  since: TrendingSince;
}

/** Shape of the README API response. `branch` is the repo's default branch
 *  (used to rewrite relative image/link paths). */
export interface ReadmeResponse {
  fullName: string;
  markdown: string;
  branch: string;
  stale: boolean;
  fetchedAt: number;
}

/** Build the clone command for the row-level copy button. */
export function cloneUrl(fullName: string): string {
  return `https://github.com/${fullName}.git`;
}

/** Build the repo's canonical GitHub page. */
export function repoUrl(fullName: string): string {
  return `https://github.com/${fullName}`;
}

/** Human label for a language slug (official English name, untranslated). */
export function languageLabel(slug: TrendingLang): string {
  return slug === "all" ? "All languages" : HOT_TRENDING_LANGUAGES[slug];
}