import { NextResponse } from "next/server";
import { matchesSessionDate, parseSessionDateRange } from "@/lib/shared/session-date-filter";
import {
  listAllSessionsHeaderOnly,
  searchSessionsPaged,
} from "@/lib/server/session-reader";
import { getRpcSession } from "@/lib/server/rpc-manager";
import { listSubagentChildSessionIds } from "@/lib/server/subagent-store";
import { resolveSessionPermissions, sessionPermissionFields } from "@/lib/server/session-permission-visibility";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import type { SessionInfo } from "@/lib/shared/types";

const log = createLogger("api/sessions");

interface Cursor {
  modified: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.modified === "string" && typeof parsed.id === "string") {
      return { modified: parsed.modified, id: parsed.id };
    }
  } catch {}
  return null;
}

function recentCwds(sessions: SessionInfo[], topN: number): string[] {
  const latestByCwd = new Map<string, string>();
  for (const s of sessions) {
    if (!s.cwd) continue;
    const prev = latestByCwd.get(s.cwd);
    if (!prev || s.modified > prev) latestByCwd.set(s.cwd, s.modified);
  }
  return [...latestByCwd.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, topN)
    .map(([cwd]) => cwd);
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const dateRange = parseSessionDateRange(url.searchParams);
  if (dateRange === undefined) {
    return NextResponse.json({ error: "Invalid session date range" }, { status: 400 });
  }
  const cwd = url.searchParams.get("cwd") || undefined;
  const limitRaw = url.searchParams.get("limit");
  const cursorRaw = url.searchParams.get("cursor");
  const q = url.searchParams.get("q")?.trim() || "";
  const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 0) : 0;
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;

  log.debug("list sessions requested", {
    cwd,
    limit: limit || undefined,
    hasCursor: !!cursor,
    q: q ? `${q.length}ch` : undefined,
  });

  try {
    const allSessions = await listAllSessionsHeaderOnly();
    const subagentIds = new Set(listSubagentChildSessionIds());
    const permissionStates = resolveSessionPermissions(allSessions.map((session) => session.id));
    const withPermissionMode = <T extends { id: string }>(row: T): T => ({
      ...row,
      ...sessionPermissionFields(permissionStates[row.id]),
    });
    const all = allSessions.filter((session) => !subagentIds.has(session.id));
    const recent = recentCwds(all, 5);

    if (q && limit > 0) {
      if (!cwd) {
        log.warn("sessions search requires cwd", { durationMs: elapsedMs(startedAt) });
        return NextResponse.json(
          { error: "cwd is required when q is set" },
          { status: 400 },
        );
      }
      const cursorId = cursor?.id ?? null;
      const search = await searchSessionsPaged(cwd, q, limit, cursorId);
      const enriched = search.results.map((s) => withPermissionMode({
        ...s,
        running: getRpcSession(s.id)?.isRunning() ?? false,
      }));
      log.info("sessions search completed", {
        cwd,
        returned: enriched.length,
        total: search.total,
        qLen: q.length,
        hasNextCursor: search.nextCursor !== null,
        durationMs: elapsedMs(startedAt),
      });
      const nextCursor = search.nextCursor
        ? encodeCursor({ modified: "", id: search.nextCursor })
        : null;
      return NextResponse.json({
        sessions: enriched,
        recentCwds: recent,
        nextCursor,
        total: search.total,
      });
    }

    const filtered = all.filter((s) => (!cwd || s.cwd === cwd) && matchesSessionDate(s.modified, dateRange));

    let page = filtered;
    let nextCursor: string | null = null;

    if (limit > 0) {
      let startIdx = 0;
      if (cursor) {
        const idx = filtered.findIndex((s) => s.id === cursor.id);
        if (idx >= 0) startIdx = idx + 1;
      }
      page = filtered.slice(startIdx, startIdx + limit);
      const hasMore = startIdx + limit < filtered.length;
      if (hasMore && page.length > 0) {
        nextCursor = encodeCursor({
          modified: page[page.length - 1].modified,
          id: page[page.length - 1].id,
        });
      } else {
        nextCursor = null;
      }
    }

    const enriched = page.map((s) => withPermissionMode({
      ...s,
      running: getRpcSession(s.id)?.isRunning() ?? false,
    }));

    log.info("list sessions completed", {
      returned: enriched.length,
      total: filtered.length,
      cwd,
      limit: limit || undefined,
      hasNextCursor: nextCursor !== null,
      durationMs: elapsedMs(startedAt),
    });
    return NextResponse.json({
      sessions: enriched,
      recentCwds: recent,
      ...(limit > 0 ? { nextCursor } : {}),
    });
  } catch (error) {
    log.error("list sessions failed", { error, cwd, durationMs: elapsedMs(startedAt) });
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
