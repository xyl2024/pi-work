// GitHub Trending panel API.
//
//   GET /api/github-trending?lang=all&since=daily&refresh=1
//     → { repos, stale, fetchedAt, lang, since }
//
// `refresh=1` bypasses the TTL (UI refresh button). `stale: true` in the
// response means the payload came from an expired cache row after a refresh
// attempt failed (the UI shows a "cached data" banner). Network failures
// with no cache row → 502 so the UI can render its error card.

import { getTrending } from "@/lib/server/github-trending/service";
import {
  isTrendingLang,
  isTrendingSince,
} from "@/lib/shared/github-trending";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;
  const refresh = params.get("refresh") === "1";

  const lang = params.get("lang") ?? "all";
  const since = params.get("since") ?? "daily";
  if (!isTrendingLang(lang) || !isTrendingSince(since)) {
    return Response.json({ error: "invalid lang or since" }, { status: 400 });
  }

  try {
    const data = await getTrending(lang, since, { refresh });
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: `Failed to load trending: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}