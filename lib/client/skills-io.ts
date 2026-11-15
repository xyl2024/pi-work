"use client";

import type {
  Skill,
  SkillDetailData,
  SkillListResponse,
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
