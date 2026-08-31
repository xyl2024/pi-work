import { NextResponse } from "next/server";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfig, writeConfig } from "@/lib/server/config";

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

// GET /api/skills?cwd=<path> — returns discovered Skills with Pi Work overrides applied.
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const { skills, diagnostics } = await loadSkills(cwd);
    const disabled = new Set(readConfig().disabled_skills[cwd] ?? []);
    return NextResponse.json({
      skills: skills.map((skill) => ({
        ...skill,
        disableModelInvocation: disabled.has(skill.filePath),
      })),
      diagnostics,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// PATCH /api/skills — toggle a Skill in Pi Work's per-cwd config.
// The SKILL.md and all other installed resources remain untouched.
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as {
      cwd: string;
      filePath: string;
      disableModelInvocation: boolean;
    };
    const { cwd, filePath, disableModelInvocation } = body;
    if (!cwd || !filePath || typeof disableModelInvocation !== "boolean") {
      return NextResponse.json({ error: "cwd, filePath and disableModelInvocation are required" }, { status: 400 });
    }

    const { skills } = await loadSkills(cwd);
    if (!skills.some((skill) => skill.filePath === filePath)) {
      return NextResponse.json({ error: "skill is not loaded for this cwd" }, { status: 404 });
    }

    const config = readConfig();
    const current = new Set(config.disabled_skills[cwd] ?? []);
    if (disableModelInvocation) current.add(filePath);
    else current.delete(filePath);

    const disabledSkills = { ...config.disabled_skills };
    if (current.size > 0) disabledSkills[cwd] = [...current].sort();
    else delete disabledSkills[cwd];
    writeConfig({ ...config, disabled_skills: disabledSkills });

    return NextResponse.json({ success: true, disableModelInvocation });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
