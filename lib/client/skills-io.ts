"use client";

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

export async function fetchSkills(cwd: string, signal?: AbortSignal): Promise<Skill[]> {
  const res = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`, { signal });
  const body = (await res.json().catch(() => ({}))) as Partial<SkillListResponse> & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.skills ?? [];
}

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

export async function fetchSkillDetail(filePath: string): Promise<SkillDetailData> {
  const res = await fetch(`/api/skills/detail?filePath=${encodeURIComponent(filePath)}`);
  const body = (await res.json().catch(() => ({}))) as Partial<SkillDetailData> & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return { content: body.content ?? "", directory: body.directory ?? "", files: body.files ?? [] };
}

export async function fetchSkillSubFile(filePath: string, subFilePath: string): Promise<string> {
  const res = await fetch(
    `/api/skills/detail?filePath=${encodeURIComponent(filePath)}&subFilePath=${encodeURIComponent(subFilePath)}`,
  );
  const body = (await res.json().catch(() => ({}))) as Partial<SkillSubFileResponse> & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.subFileContent ?? "";
}

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

export interface SkillInstallHandlers {
  onLog: (line: string) => void;
}

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
    void reader.cancel().catch(() => {});
  }

  if (!done) throw new Error("Install stream ended without a result");
}
