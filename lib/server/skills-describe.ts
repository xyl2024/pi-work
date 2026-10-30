import { createLogger, elapsedMs } from "./logger";

const log = createLogger("server/skills-describe");

const SKILLS_API_BASE = (process.env.SKILLS_API_URL || "https://skills.sh").replace(/\/+$/, "");
const FETCH_TIMEOUT_MS = 8000;
const CONCURRENCY = 10;
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
  description: string;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

function isSafeSlug(slug: string): boolean {
  if (!slug || slug.length > 300) return false;
  if (slug.includes("..") || slug.startsWith("/") || slug.includes("//")) return false;
  return /^[A-Za-z0-9._@:-]+(?:\/[A-Za-z0-9._@:-]+)*$/.test(slug);
}

const LD_JSON_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
const META_DESC_RE = /<meta[^>]+name="description"[^>]+content="([^"]*)"/i;

function extractDescription(html: string): string {
  LD_JSON_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LD_JSON_RE.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]) as { "@type"?: string; description?: string };
      if (data?.["@type"] === "SoftwareApplication" && typeof data.description === "string") {
        const description = data.description.trim();
        if (description) return description;
      }
    } catch {
    }
  }
  return META_DESC_RE.exec(html)?.[1]?.trim() ?? "";
}

async function fetchOne(slug: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SKILLS_API_BASE}/${slug}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "pi-work/skills-describe", accept: "text/html" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    return extractDescription(html);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchSkillDescriptions(slugs: string[]): Promise<Record<string, string>> {
  const startedAt = Date.now();
  const unique = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))];
  const result: Record<string, string> = {};
  const now = Date.now();

  const pending: string[] = [];
  for (const slug of unique) {
    if (!isSafeSlug(slug)) {
      result[slug] = "";
      continue;
    }
    const cached = cache.get(slug);
    if (cached && cached.expires > now) {
      result[slug] = cached.description;
    } else {
      pending.push(slug);
    }
  }

  if (pending.length > 0) {
    const fetched = await mapPool(pending, CONCURRENCY, fetchOne);
    pending.forEach((slug, i) => {
      result[slug] = fetched[i];
      cache.set(slug, { description: fetched[i], expires: Date.now() + CACHE_TTL_MS });
    });
  }

  log.info("resolved skill descriptions", {
    requested: unique.length,
    fetched: pending.length,
    found: Object.values(result).filter(Boolean).length,
    durationMs: elapsedMs(startedAt),
  });
  return result;
}
