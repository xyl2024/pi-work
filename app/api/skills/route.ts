import { NextResponse } from "next/server";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfig, writeConfig } from "@/lib/server/config";
import { loadPiWorkSkills } from "@/lib/server/pi-work-skills";
import type {
  Skill,
  SkillListResponse,
  SkillToggleRequest,
  SkillToggleResponse,
} from "@/lib/shared/skills";

export const dynamic = "force-dynamic";

async function loadSkills(cwd: string) {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  return loader.getSkills();
}

export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const { skills, diagnostics } = await loadSkills(cwd);
    const piWorkSkills = loadPiWorkSkills().skills;
    const allSkills = [...skills, ...piWorkSkills];
    const disabled = new Set(readConfig().disabled_skills[cwd] ?? []);
    const mapped: Skill[] = allSkills.map((skill) => ({
      ...skill,
      disableModelInvocation: skill.disableModelInvocation || disabled.has(skill.filePath),
      frontmatterDisabled: skill.disableModelInvocation === true,
    }));
    const body: SkillListResponse = { skills: mapped, diagnostics };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as SkillToggleRequest;
    const { cwd, filePath, disableModelInvocation } = body;
    if (!cwd || !filePath || typeof disableModelInvocation !== "boolean") {
      return NextResponse.json({ error: "cwd, filePath and disableModelInvocation are required" }, { status: 400 });
    }

    const { skills } = await loadSkills(cwd);
    const piWorkSkills = loadPiWorkSkills().skills;
    const candidateSkills = [...skills, ...piWorkSkills];
    const loaderSkill = candidateSkills.find((skill) => skill.filePath === filePath);
    if (!loaderSkill) {
      return NextResponse.json({ error: "skill is not loaded for this cwd" }, { status: 404 });
    }

    if (!disableModelInvocation && loaderSkill.disableModelInvocation) {
      return NextResponse.json(
        { error: "Disabled by SKILL.md frontmatter (disable-model-invocation: true); edit the frontmatter to enable it." },
        { status: 409 },
      );
    }

    const config = readConfig();
    const current = new Set(config.disabled_skills[cwd] ?? []);
    if (disableModelInvocation) current.add(filePath);
    else current.delete(filePath);

    const disabledSkills = { ...config.disabled_skills };
    if (current.size > 0) disabledSkills[cwd] = [...current].sort();
    else delete disabledSkills[cwd];
    writeConfig({ ...config, disabled_skills: disabledSkills });

    const response: SkillToggleResponse = { success: true, disableModelInvocation };
    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
