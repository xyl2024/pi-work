"use client";

/**
 * HTTP wiring for the skills panel.
 *
 * The requests live here so a contract change (a new field, a different error
 * shape) lands in one place instead of being duplicated across the panel's
 * pages. The search / install endpoints join the panel in the follow-up slices
 * and are wired through this same module.
 */

import type {
  Skill,
  SkillDetailData,
  SkillListResponse,
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
