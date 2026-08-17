import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { NextResponse } from "next/server";
import { DefaultResourceLoader, getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath } from "@/lib/session-reader";
import { createLogger, elapsedMs } from "@/lib/logger";

const log = createLogger("api/slash-commands");

type SlashResource = {
  source: "prompt" | "skill";
  name: string;
  command: string;
  description: string;
  argumentHint?: string;
  path: string;
  location?: string;
  content: string;
};

// Module-level cache: cwd → { prompts, skills, commands, expiresAt }
const SLASH_CACHE_TTL_MS = 30_000;
type CachedSlash = {
  prompts: SlashResource[];
  skills: SlashResource[];
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
      promptCount: cached.prompts.length,
      skillCount: cached.skills.length,
      durationMs: elapsedMs(startedAt),
    });
    return cached;
  }

  const existing = slashInflight.get(cwd);
  if (existing) {
    const result = await existing;
    log.debug("slash commands joined in-flight load", {
      cwd,
      promptCount: result.prompts.length,
      skillCount: result.skills.length,
      durationMs: elapsedMs(startedAt),
    });
    return result;
  }

  const loadPromise = (async (): Promise<CachedSlash> => {
    const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
    await loader.reload();

    const prompts: SlashResource[] = loader.getPrompts().prompts.map((prompt) => ({
      source: "prompt",
      name: prompt.name,
      command: prompt.name,
      description: prompt.description,
      ...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
      path: prompt.filePath,
      location: prompt.sourceInfo.scope,
      content: prompt.content,
    }));

    const skills: SlashResource[] = await Promise.all(
      loader.getSkills().skills.map(async (skill) => ({
        source: "skill" as const,
        name: skill.name,
        command: `skill:${skill.name}`,
        description: skill.description,
        path: skill.filePath,
        location: skill.sourceInfo.scope,
        content: await readFile(skill.filePath, "utf-8"),
      }))
    );

    const commands = [...prompts, ...skills];
    const result: CachedSlash = { prompts, skills, commands, expiresAt: startedAt + SLASH_CACHE_TTL_MS };
    slashCache.set(cwd, result);

    log.info("slash commands loaded", {
      cwd,
      promptCount: prompts.length,
      skillCount: skills.length,
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
    return NextResponse.json({
      prompts: result.prompts,
      skills: result.skills,
      commands: result.commands,
    });
  } catch (error) {
    log.error("slash commands failed", { error, durationMs: elapsedMs(startedAt) });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}