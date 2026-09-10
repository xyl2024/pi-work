import { NextResponse } from "next/server";
import { runNpx } from "@/lib/server/npx";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { sanitizeChildEnv } from "@/lib/server/env-sanitize";
import { fetchSkillDescriptions } from "@/lib/server/skills-describe";

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;
const MAX_LIMIT = 50;
const DEFAULT_PAGE_SIZE = 6;
const MAX_PAGE_SIZE = 50;
const SEARCH_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";
const QUERY_CACHE_TTL_MS = 5 * 60 * 1000;
const log = createLogger("api/skills/search");

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
  /** skills.sh page path (`owner/repo/skill`), used to resolve the description. */
  slug: string;
  /** Full SKILL.md description, resolved server-side with the search so the
   *  panel never has to fetch it lazily. Empty when unavailable. */
  description: string;
}

interface SkillsApiSkill {
  id?: string;
  name?: string;
  source?: string;
  installs?: number;
}

interface SkillsApiResponse {
  skills?: SkillsApiSkill[];
}

interface CachedQuery {
  /** Enriched result set for the query, truncated to the requested limit. */
  results: SkillSearchResult[];
  expires: number;
}

const queryCache = new Map<string, CachedQuery>();

function parsePageSize(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(num)));
}

function parsePage(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.floor(num));
}

function formatInstalls(count?: number): string {
  if (!count || count <= 0) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`;
  return `${count} install${count === 1 ? "" : "s"}`;
}

function parseSearchOutput(raw: string): SkillSearchResult[] {
  const clean = raw.replace(ANSI_RE, "");
  const results: SkillSearchResult[] = [];
  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // package line: "owner/repo@skill  NNK installs"
    const pkgMatch = line.match(/^([\w.\-]+\/[\w.\-@:]+)\s+([\d.,]+[KMB]?\s+installs)$/);
    if (pkgMatch) {
      const urlLine = lines[i + 1]?.trim().replace(/^└\s*/, "");
      const url = urlLine?.startsWith("https://") ? urlLine : "";
      results.push({
        package: pkgMatch[1],
        installs: pkgMatch[2],
        url,
        slug: url ? url.replace(/^https?:\/\/[^/]+\//, "") : "",
        description: "",
      });
    }
  }
  return results;
}

async function searchSkillsApi(query: string, limit: number): Promise<SkillSearchResult[]> {
  const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`skills.sh search failed: HTTP ${res.status}`);

  const data = (await res.json()) as SkillsApiResponse;
  return (data.skills ?? [])
    .map((skill) => {
      const name = skill.name?.trim();
      const source = skill.source?.trim();
      const slug = skill.id?.trim();
      if (!name || (!source && !slug)) return null;

      const pkg = `${source || slug}@${name}`;
      return {
        package: pkg,
        installs: formatInstalls(skill.installs),
        url: slug ? `${SEARCH_API_BASE}/${slug}` : "",
        slug: slug ?? "",
        description: "",
      };
    })
    .filter((skill): skill is SkillSearchResult => skill !== null)
    .sort((a, b) => parseInstallCount(b.installs) - parseInstallCount(a.installs));
}

function parseInstallCount(installs: string): number {
  const match = installs.match(/^([\d.]+)([KMB])?\s+installs?$/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const multiplier = match[2] === "B" ? 1_000_000_000 : match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1;
  return value * multiplier;
}

/** Upstream skills.sh ignores offset/page/skip, so "load more" is implemented
 *  by asking for a larger `limit` each time (`pageSize * page`) and slicing the
 *  tail — deterministic because the ranking is stable. Descriptions are
 *  resolved for the whole truncated set and the result is cached per
 *  (source, query, limit) so re-scrolling within a session is free. */
async function getResults(query: string, limit: number, source: "api" | "npx"): Promise<SkillSearchResult[]> {
  const cacheKey = `${source}::${query}::${limit}`;
  const cached = queryCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.results;

  const base =
    source === "api"
      ? await searchSkillsApi(query, limit)
      : await (async () => {
          const { stdout, stderr } = await runNpx(["skills", "find", query], {
            timeout: 20000,
            env: { ...sanitizeChildEnv(process.env), FORCE_COLOR: "0" },
          });
          return parseSearchOutput(stdout + stderr).slice(0, limit);
        })();

  const descriptions = await fetchSkillDescriptions(base.map((r) => r.slug).filter(Boolean));
  const results = base.map((r) => ({
    ...r,
    description: r.slug ? descriptions[r.slug] ?? "" : "",
  }));

  queryCache.set(cacheKey, { results, expires: Date.now() + QUERY_CACHE_TTL_MS });
  return results;
}

// POST /api/skills/search  body: { query: string, page?: number, pageSize?: number }
// Returns one page of the result set:
//   { results, page, pageSize, hasMore }
export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const { query, page: rawPage, pageSize: rawPageSize } = await req.json() as {
      query?: string;
      page?: unknown;
      pageSize?: unknown;
    };
    if (!query?.trim()) {
      log.warn("skill search rejected", { reason: "missing query", durationMs: elapsedMs(startedAt) });
      return NextResponse.json({ error: "query required" }, { status: 400 });
    }
    const pageSize = parsePageSize(rawPageSize);
    const page = parsePage(rawPage);
    const trimmedQuery = query.trim();
    // Each page asks upstream for one more page worth of results.
    const upstreamLimit = Math.min(MAX_LIMIT, page * pageSize);

    const respond = (all: SkillSearchResult[], source: "api" | "npx") => {
      const start = (page - 1) * pageSize;
      const results = all.slice(start, start + pageSize);
      // `all.length === upstreamLimit` means upstream filled the request, so
      // there may be more; a short response means the well is dry.
      const hasMore = all.length >= upstreamLimit && results.length > 0;
      log.info("skill search completed", {
        query: trimmedQuery,
        page,
        pageSize,
        upstreamLimit,
        fetched: all.length,
        returned: results.length,
        hasMore,
        source,
        durationMs: elapsedMs(startedAt),
      });
      return NextResponse.json({ results, page, pageSize, hasMore });
    };

    log.info("skill search requested", { query: trimmedQuery, page, pageSize, upstreamLimit });

    try {
      const all = await getResults(trimmedQuery, upstreamLimit, "api");
      return respond(all, "api");
    } catch (error) {
      log.warn("skill search api failed; falling back to npx", { query: trimmedQuery, error });
      const all = await getResults(trimmedQuery, upstreamLimit, "npx");
      return respond(all, "npx");
    }
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const raw = (err.stdout ?? "") + (err.stderr ?? "");
    const recovered = raw ? parseSearchOutput(raw) : [];
    if (recovered.length > 0) {
      log.warn("skill search recovered results from failed command", {
        resultCount: recovered.length,
        durationMs: elapsedMs(startedAt),
      });
      const withDescriptions = await fetchSkillDescriptions(recovered.map((r) => r.slug).filter(Boolean));
      const all = recovered.map((r) => ({ ...r, description: r.slug ? withDescriptions[r.slug] ?? "" : "" }));
      return NextResponse.json({ results: all, page: 1, pageSize: all.length, hasMore: false });
    }
    log.error("skill search failed", { error: err.message ?? String(e), durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: err.message ?? String(e) }, { status: 500 });
  }
}
