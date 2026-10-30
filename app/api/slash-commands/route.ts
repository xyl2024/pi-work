import { existsSync } from "fs";
import { NextResponse } from "next/server";
import { DefaultResourceLoader, getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath } from "@/lib/server/session-reader";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { readConfig } from "@/lib/server/config";
import { loadPiWorkSkillsSafety } from "@/lib/server/pi-work-skills";

const log = createLogger("api/slash-commands");

type SlashResource = {
  source: "skill";
  name: string;
  command: string;
  description: string;
  path: string;
};

const SLASH_CACHE_TTL_MS = 30_000;
type CachedSlash = {
  commands: SlashResource[];
  expiresAt: number;
};
const slashCache = new Map<string, CachedSlash>();
const slashInflight = new Map<string, Promise<CachedSlash>>();

async function resolveCwd(url: URL): Promise<string | null> {
  const cwd = url.searchParams.get("cwd");
  if (cwd) return cwd;

  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return null;

  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  return SessionManager.open(filePath).getHeader()?.cwd ?? null;
}

async function loadSlashCommands(cwd: string, startedAt: number): Promise<CachedSlash> {
  const cached = slashCache.get(cwd);
  if (cached && cached.expiresAt > startedAt) {
    log.debug("slash commands cached", {
      cwd,
      commandCount: cached.commands.length,
      durationMs: elapsedMs(startedAt),
    });
    return cached;
  }

  const existing = slashInflight.get(cwd);
  if (existing) {
    const result = await existing;
    log.debug("slash commands joined in-flight load", {
      cwd,
      commandCount: result.commands.length,
      durationMs: elapsedMs(startedAt),
    });
    return result;
  }

  const loadPromise = (async (): Promise<CachedSlash> => {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      noExtensions: true,
      noThemes: true,
      noContextFiles: true,
      noPromptTemplates: true,
    });
    await loader.reload();

    const disabledSkillPaths = new Set(readConfig().disabled_skills[cwd] ?? []);
    const loaderAndPiWorkSkills = [
      ...loader.getSkills().skills,
      ...loadPiWorkSkillsSafety(),
    ];
    const commands: SlashResource[] = loaderAndPiWorkSkills
      .filter((skill) => !disabledSkillPaths.has(skill.filePath))
      .map((skill) => ({
        source: "skill" as const,
        name: skill.name,
        command: `skill:${skill.name}`,
        description: skill.description,
        path: skill.filePath,
      }));

    const result: CachedSlash = { commands, expiresAt: startedAt + SLASH_CACHE_TTL_MS };
    slashCache.set(cwd, result);

    log.info("slash commands loaded", {
      cwd,
      commandCount: commands.length,
      durationMs: elapsedMs(startedAt),
    });

    return result;
  })();

  slashInflight.set(cwd, loadPromise);
  try {
    return await loadPromise;
  } finally {
    if (slashInflight.get(cwd) === loadPromise) {
      slashInflight.delete(cwd);
    }
  }
}

export async function GET(req: Request) {
  const startedAt = Date.now();

  try {
    const url = new URL(req.url);
    const cwd = await resolveCwd(url);

    if (!cwd) {
      return NextResponse.json({ error: "cwd or sessionId is required" }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    const result = await loadSlashCommands(cwd, startedAt);
    return NextResponse.json({ commands: result.commands });
  } catch (error) {
    log.error("slash commands failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
