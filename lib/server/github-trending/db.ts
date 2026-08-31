// ── GitHub Trending: SQLite cache ─────────────────────────────────────────
// Mirrors the per-domain db singleton pattern used elsewhere in the repo
// (scheduler/db.ts, workflow/db.ts): its own file under the data root
// (`~/.pi-work/github-trending.db`, overridable via
// `PI_WORK_GITHUB_TRENDING_DB`), clipboard-cached on `globalThis` so
// dev-mode HMR doesn't reopen the handle, WAL journaling, and idempotent
// additive migrations.
//
// Two tables:
//   - trending_cache: one JSON blob per (lang, since) key — the trending
//     list is fetched as a block and always read back as a block.
//   - readme_cache: rendered-doc-ready README markdown per repo, plus the
//     default branch (needed to rewrite relative image/link paths).
//
// The cache is on-disk by design (the panel was spec'd to survive restarts
// and serve offline); TTLs and stale-fallback semantics live in
// `service.ts`.

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { dataPath } from "@/lib/server/data-dir";

// ── Module-level singleton (HMR-safe) ─────────────────────────────────────
declare global {
  var __piGithubTrendingDb: Database.Database | undefined;
}

function resolveDbPath(): string {
  const override = process.env.PI_WORK_GITHUB_TRENDING_DB?.trim();
  if (override) return override;
  return dataPath("github-trending.db");
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS trending_cache (
    lang       TEXT NOT NULL,
    since      TEXT NOT NULL,
    data       TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (lang, since)
  );

  CREATE TABLE IF NOT EXISTS readme_cache (
    full_name  TEXT PRIMARY KEY,
    markdown   TEXT NOT NULL,
    branch     TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`;

/** Additive, idempotent migrations for DBs seeded before a column shipped. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function runMigrations(_db: Database.Database): void {
  // No migrations yet — both tables shipped with their full column set on
  // day one. Future columns follow the scheduler/workflow pattern:
  //   const cols = db.prepare("PRAGMA table_info(t)").all() as Array<{ name: string }>;
  //   if (!cols.some((c) => c.name === "x")) { db.exec("ALTER TABLE t ADD COLUMN x ..."); }
}

export function getGithubTrendingDb(): Database.Database {
  if (globalThis.__piGithubTrendingDb) return globalThis.__piGithubTrendingDb;

  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  runMigrations(db);

  globalThis.__piGithubTrendingDb = db;
  return db;
}

export interface TrendingCacheRow {
  lang: string;
  since: string;
  data: string;
  fetched_at: number;
}

export interface ReadmeCacheRow {
  full_name: string;
  markdown: string;
  branch: string;
  fetched_at: number;
}

export function readTrendingCache(
  lang: string,
  since: string,
): TrendingCacheRow | undefined {
  return getGithubTrendingDb()
    .prepare(
      "SELECT lang, since, data, fetched_at FROM trending_cache WHERE lang = ? AND since = ?",
    )
    .get(lang, since) as TrendingCacheRow | undefined;
}

export function writeTrendingCache(
  lang: string,
  since: string,
  data: string,
  fetchedAt: number,
): void {
  getGithubTrendingDb()
    .prepare(
      `INSERT INTO trending_cache (lang, since, data, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (lang, since) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
    )
    .run(lang, since, data, fetchedAt);
}

export function readReadmeCache(fullName: string): ReadmeCacheRow | undefined {
  return getGithubTrendingDb()
    .prepare(
      "SELECT full_name, markdown, branch, fetched_at FROM readme_cache WHERE full_name = ?",
    )
    .get(fullName) as ReadmeCacheRow | undefined;
}

export function writeReadmeCache(
  fullName: string,
  markdown: string,
  branch: string,
  fetchedAt: number,
): void {
  getGithubTrendingDb()
    .prepare(
      `INSERT INTO readme_cache (full_name, markdown, branch, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (full_name) DO UPDATE SET
         markdown = excluded.markdown,
         branch = excluded.branch,
         fetched_at = excluded.fetched_at`,
    )
    .run(fullName, markdown, branch, fetchedAt);
}