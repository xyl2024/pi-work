"use client";

/**
 * HTTP wiring for the skills panel.
 *
 * The requests live here so a contract change (a new field, a different error
 * shape) lands in one place instead of being duplicated across the panel's
 * pages. The detail / search / install endpoints join the panel in the
 * follow-up slices and are wired through this same module.
 */

import type {
  Skill,
  SkillListResponse,
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
