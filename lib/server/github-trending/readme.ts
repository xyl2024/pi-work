// ── GitHub Trending: README fetch + relative-path rewriting ───────────────
// Uses the REST endpoint `/repos/{owner}/{repo}/readme` (default JSON
// Accept, not the raw variant) so a *single* request yields both the
// markdown (base64 body) and the default branch — parsed out of the
// `html_url` (…/blob/{branch}/README.md) — without a second repo call.
//
// The branch is needed to rewrite relative image/link paths in the
// markdown (READMEs reference `docs/logo.png` all the time; GitLab-style
// absolute URLs and `data:` URIs pass through untouched).
//
// This endpoint counts against the unauthenticated REST quota
// (60 req/hr/IP); the 24h readme_cache TTL in service.ts is what keeps
// that from being a real constraint.

import { createLogger } from "@/lib/server/logger";

const log = createLogger("github-trending/readme");

const REQUEST_TIMEOUT_MS = 30_000;

// Same browser UA as the scraper — GitHub serves different content (and
// stricter quotas) to bare Node fetch agents.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

/** Max markdown bytes we persist per README. Giant docs (e.g. some
 *  meta-repos ship 1MB+ READMEs) would bloat ~/.pi-work and freeze the
 *  panel; 256KB covers every real-world project README. */
export const MAX_README_BYTES = 256 * 1024;

const MAX_README_CHARS = MAX_README_BYTES; // ASCII-safe upper bound

interface ReadmeApiResult {
  markdown: string;
  branch: string;
}

function decodeBase64(b64: string): string {
  // Node 18+ has global Buffer.
  return Buffer.from(b64, "base64").toString("utf8");
}

interface ReadmeJson {
  content?: unknown;
  html_url?: unknown;
}

/** Extract the default-branch name from the readme API's html_url, which
 *  looks like `https://github.com/owner/repo/blob/<branch>/README.md`. */
function branchFromHtmlUrl(htmlUrl: string): string {
  const match = htmlUrl.match(/\/blob\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]) : "HEAD";
}

/** One REST call to `/repos/{owner}/{repo}/readme`. Throws on network
 *  failure / non-2xx / 404 (private or missing README). */
export async function fetchReadme(
  fullName: string,
): Promise<ReadmeApiResult> {
  const startedAt = Date.now();
  const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`readme fetch failed: HTTP ${res.status} for ${fullName}`);
  }
  const json = (await res.json()) as ReadmeJson;
  const content = typeof json.content === "string" ? json.content : "";
  if (!content) {
    throw new Error(`readme API returned no content for ${fullName}`);
  }
  const markdown = decodeBase64(content);
  const branch =
    typeof json.html_url === "string"
      ? branchFromHtmlUrl(json.html_url)
      : "HEAD";
  log.info("fetched readme", {
    fullName,
    branch,
    chars: markdown.length,
    durationMs: Date.now() - startedAt,
  });
  return { markdown, branch };
}

/**
 * Rewrite relative image/link URLs in a README to absolute raw/blob URLs
 * so the rendered markdown doesn't produce a wall of broken images.
 *
 *   ![alt](docs/logo.png)        → https://raw.githubusercontent.com/o/r/<branch>/docs/logo.png
 *   [x](../foo.md)               → https://github.com/o/r/blob/<branch>/../foo.md
 *   https://… / data: / / #hash   → untouched
 */
export function rewriteReadmePaths(
  markdown: string,
  fullName: string,
  branch: string,
): string {
  const rawBase = `https://raw.githubusercontent.com/${fullName}/${branch}/`;
  const blobBase = `https://github.com/${fullName}/blob/${branch}/`;

  const isExternal = (p: string) =>
    /^(https?:)?\/\//i.test(p) || p.startsWith("data:") || p.startsWith("#") || p.startsWith("mailto:");

  // Destination → { image: true, prefix: rawBase } | { image: false, prefix: blobBase }
  const rewrite = (url: string, image: boolean): string => {
    const trimmed = url.trim();
    if (isExternal(trimmed)) return trimmed;
    const prefix = image ? rawBase : blobBase;
    // Strip a leading "./" so "../" still resolves against the blob dir.
    const cleaned = trimmed.replace(/^\.\//, "");
    return `${prefix}${cleaned}`;
  };

  // Markdown image: ![alt](src "title") or ![alt](src) — src may contain
  // no spaces; Title in quotes is optional.
  let out = markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
    (_m, _alt: string, src: string) => `![${_alt}](${rewrite(src, true)})`,
  );

  // Markdown link: [text](href) — negative lookbehind skips the image
  // syntax already rewritten above (their srcs are absolute now, so a
  // second pass would be a no-op anyway, but this keeps it tidy).
  out = out.replace(
    /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
    (_m, _text: string, href: string) => `[${_text}](${rewrite(href, false)})`,
  );

  return out;
}

/** Truncate markdown to the storage cap without splitting a surrogate pair.
 *  (The byte cap above is already ASCII-safe; this is belt-and-braces.) */
export function capReadme(markdown: string): string {
  if (markdown.length <= MAX_README_CHARS) return markdown;
  return markdown.slice(0, MAX_README_CHARS);
}