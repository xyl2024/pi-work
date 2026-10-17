"use client";

/**
 * HTTP wiring for the skills panel.
 *
 * The requests live here so a contract change (a new field, a different error
 * shape) lands in one place instead of being duplicated across the panel's
 * pages: list / toggle / detail are plain JSON, search is a POST, and install
 * is a hand-read SSE body (the browser's `EventSource` only speaks GET).
 */

import { splitSseEvents } from "@/lib/shared/sse";
import type {
  Skill,
  SkillDetailData,
  SkillInstallEvent,
  SkillInstallRequest,
  SkillListResponse,
  SkillSearchResponse,
  SkillSearchResult,
  SkillSubFileResponse,
  SkillToggleRequest,
  SkillToggleResponse,
} from "@/lib/shared/skills";

/** GET the skills discovered for `cwd`, with Pi Work's per-cwd overrides applied. */
export async function fetchSkills(cwd: string): Promise<Skill[]> {
  const res = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
  const body = (await res.json().catch(() => ({}))) as Partial<SkillListResponse> & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.skills ?? [];
}

/**
 * PATCH one skill's invocation flag into Pi Work's per-cwd config. Resolves on
 * success and throws the server's message (e.g. the frontmatter lock) otherwise.
 */
export async function patchSkillInvocation(req: SkillToggleRequest): Promise<SkillToggleResponse> {
  const res = await fetch("/api/skills", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<SkillToggleResponse> & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return {
    success: true,
    disableModelInvocation: body.disableModelInvocation ?? req.disableModelInvocation,
  };
}

/**
 * GET one skill's SKILL.md content plus its attached-file manifest. Called
 * fresh every time the detail page opens — the body is never cached in the
 * store, because the file on disk may have changed while the panel was closed.
 */
export async function fetchSkillDetail(filePath: string): Promise<SkillDetailData> {
  const res = await fetch(`/api/skills/detail?filePath=${encodeURIComponent(filePath)}`);
  const body = (await res.json().catch(() => ({}))) as Partial<SkillDetailData> & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return { content: body.content ?? "", directory: body.directory ?? "", files: body.files ?? [] };
}

/**
 * GET one attached file's text for the inline preview. Throws the server's
 * message (e.g. "binary file cannot be previewed") so the row can show it.
 */
export async function fetchSkillSubFile(filePath: string, subFilePath: string): Promise<string> {
  const res = await fetch(
    `/api/skills/detail?filePath=${encodeURIComponent(filePath)}&subFilePath=${encodeURIComponent(subFilePath)}`,
  );
  const body = (await res.json().catch(() => ({}))) as Partial<SkillSubFileResponse> & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.subFileContent ?? "";
}

/**
 * Search skills.sh for one page. skills.sh has no offset, so the server serves
 * "page N" by asking upstream for `pageSize × N` rows and keeping the tail; the
 * caller still pages by asking for the next number.
 */
export async function searchSkills(
  query: string,
  page: number,
  pageSize: number,
): Promise<SkillSearchResponse> {
  const res = await fetch("/api/skills/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, page, pageSize }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<SkillSearchResponse> & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return {
    results: (body.results ?? []) as SkillSearchResult[],
    page: body.page ?? page,
    pageSize: body.pageSize ?? pageSize,
    hasMore: body.hasMore ?? false,
  };
}

/** Callbacks for one streaming install. `onLog` fires for every line the CLI
 *  prints, in arrival order, so the page can show live progress. */
export interface SkillInstallHandlers {
  onLog: (line: string) => void;
}

/**
 * Run `npx skills add` and pump its SSE body to `onLog`. Resolves when the
 * server reports `done`; throws the server's message on an `error` event (the
 * route folds the tail of the CLI output into it) or when the stream ends
 * without a result.
 *
 * The stream is read here rather than with an `EventSource` in the component,
 * so a component unmount cannot abort the request mid-flight: the store drives
 * it (see `skills-store`), nobody may be listening to `onLog` any more, but the
 * CLI keeps running to completion. Only the store's explicit cancel passes
 * `signal`, which drops the client reader — the server's child process still
 * finishes, because the route never watches the connection.
 */
export async function installSkill(
  req: SkillInstallRequest,
  handlers: SkillInstallHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/skills/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  try {
    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = splitSseEvents(buffer);
      buffer = rest;
      for (const data of events) {
        if (!data.trim()) continue;
        const event = JSON.parse(data) as SkillInstallEvent;
        if (event.type === "log" && event.line) handlers.onLog(event.line);
        else if (event.type === "done") done = true;
        else if (event.type === "error") throw new Error(event.message || "Install failed");
      }
    }
  } finally {
    // Abandoning a failed stream must not leave the reader locked.
    void reader.cancel().catch(() => {});
  }

  if (!done) throw new Error("Install stream ended without a result");
}
