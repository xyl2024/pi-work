import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createExtensionRuntime,
  getAgentDir,
  type AgentSession,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getAuditModelRuntime } from "./llm-audit";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ResolvedModel {
  provider: string;
  modelId: string;
}

export interface DirectPromptOptions {
  systemPrompt: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  timeoutMs?: number;
}

function buildEmptyResourceLoader(systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

async function getDirectRuntime(): Promise<ModelRuntime> {
  return getAuditModelRuntime(await ModelRuntime.create());
}

export async function resolveDirectModel(opts?: { provider?: string; modelId?: string }): Promise<ResolvedModel> {
  const agentDir = getAgentDir();
  const cwd = process.cwd();
  const runtime = await ModelRuntime.create();

  if (opts?.provider && opts?.modelId) {
    const model = runtime.getModel(opts.provider, opts.modelId);
    if (!model) throw new Error(`Model not available: ${opts.provider}/${opts.modelId}`);
    return { provider: opts.provider, modelId: opts.modelId };
  }

  const settings = SettingsManager.create(cwd, agentDir);
  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  if (!provider) {
    throw new Error("No default model configured in ~/.pi/agent/settings.json");
  }
  const model = runtime.getModel(provider, modelId ?? "");
  if (!model) {
    throw new Error(`Default model not available: ${provider}/${modelId ?? ""}`);
  }
  return { provider, modelId: modelId ?? "" };
}

export async function createDirectLlmSession(
  provider: string,
  modelId: string,
  systemPrompt: string,
  thinkingLevel: ThinkingLevel = "off",
): Promise<AgentSession> {
  const runtime = await getDirectRuntime();
  const model = runtime.getModel(provider, modelId);
  if (!model) throw new Error(`Model not available: ${provider}/${modelId}`);

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({}),
    resourceLoader: buildEmptyResourceLoader(systemPrompt),
    modelRuntime: runtime,
    model,
    thinkingLevel,
    noTools: "all",
  });

  return session;
}

export async function directPrompt(promptText: string, opts: DirectPromptOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 50_000;
  const thinkingLevel = opts.thinkingLevel ?? "off";
  const resolved = await resolveDirectModel({ provider: opts.provider, modelId: opts.modelId });
  const agentSession = await createDirectLlmSession(
    resolved.provider,
    resolved.modelId,
    opts.systemPrompt,
    thinkingLevel,
  );

  let fullText = "";
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const unsub = agentSession.subscribe((event: { type: string; [k: string]: unknown }) => {
      if (event.type === "message_update") {
        const inner = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        if (inner?.type === "text_delta" && typeof inner.delta === "string") {
          fullText += inner.delta;
        }
      }
    });

    await Promise.race([
      agentSession.prompt(promptText),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          agentSession.abort().catch(() => {});
          reject(new Error(`LLM call timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
    try { unsub(); } catch {}
    return fullText;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    try { agentSession.dispose(); } catch {}
  }
}
