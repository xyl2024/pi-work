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
        // The SKILL.md frontmatter (`disable-model-invocation: true`) is
        // authoritative in pi: such a skill is NEVER rendered into the system
        // prompt's <available_skills> (it is only invocable via /skill:name),
        // no matter what Pi Work's per-cwd config says. Merge both sources so
        // the UI shows the effective state, and expose `frontmatterDisabled`
        // so the UI can explain why the toggle is locked.
        disableModelInvocation: skill.disableModelInvocation || disabled.has(skill.filePath),
        frontmatterDisabled: skill.disableModelInvocation === true,
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
    const loaderSkill = skills.find((skill) => skill.filePath === filePath);
    if (!loaderSkill) {
      return NextResponse.json({ error: "skill is not loaded for this cwd" }, { status: 404 });
    }

    // A skill disabled by its SKILL.md frontmatter (disable-model-invocation:
    // true) is authoritative in pi and cannot be re-enabled from Pi Work's
    // per-cwd config — only editing the SKILL.md frontmatter can.
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

    return NextResponse.json({ success: true, disableModelInvocation });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
