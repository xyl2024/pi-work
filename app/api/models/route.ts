import { ModelRuntime, SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { createLogger, elapsedMs } from "@/lib/server/logger";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const log = createLogger("api/models");

type RuntimeModelInfo = {
  id: string;
  name: string;
  provider: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input: string[];
  cost: unknown;
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
};

function serializeModel(model: {
  id: string;
  name: string;
  provider: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input: readonly string[];
  cost: unknown;
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: object;
}): RuntimeModelInfo {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    thinkingLevelMap: model.thinkingLevelMap ? { ...model.thinkingLevelMap } : undefined,
    input: [...model.input],
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    headers: model.headers ? { ...model.headers } : undefined,
    compat: model.compat ? { ...model.compat } : undefined,
  };
}

/**
 * Custom-model icon map, read from ~/.pi/agent/models.json. Both custom
 * providers and custom models can carry an `icon` field whose value is a
 * builtin provider id (chosen in ModelsConfig); the assistant message header
 * uses this to render an icon for custom models. A model without its own icon
 * falls back to its provider's icon. Keyed "<provider>:<modelId>" (model wins),
 * plus a bare provider key and a bare modelId fallback mirroring how
 * modelNames resolves display names.
 */
async function readModelIcons(): Promise<Record<string, string>> {
  const icons: Record<string, string> = {};
  try {
    const raw = JSON.parse(await readFile(join(getAgentDir(), "models.json"), "utf-8"));
    const providers = (raw as { providers?: Record<string, unknown> } | null)?.providers;
    if (!providers) return icons;
    for (const [providerName, p] of Object.entries(providers)) {
      const pIcon = typeof (p as { icon?: unknown } | null)?.icon === "string"
        ? (p as { icon: string }).icon.trim()
        : "";
      if (pIcon && !icons[providerName]) icons[providerName] = pIcon;
      const models = (p as { models?: unknown } | null)?.models;
      if (!Array.isArray(models)) continue;
      for (const m of models) {
        const id = (m as { id?: unknown } | null)?.id;
        if (typeof id !== "string" || !id) continue;
        const mIcon = typeof (m as { icon?: unknown } | null)?.icon === "string"
          ? (m as { icon: string }).icon.trim()
          : "";
        const icon = mIcon || pIcon; // model-level icon wins over provider-level
        if (!icon) continue;
        const qualified = `${providerName}:${id}`;
        if (!icons[qualified]) icons[qualified] = icon;
        if (!icons[id]) icons[id] = icon;
      }
    }
  } catch (error) {
    log.warn("failed to read models.json for icons", { error });
  }
  return icons;
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const refreshCatalog = new URL(req.url).searchParams.get("refresh") === "true";
  const nameMap = new Map<string, string>();
  let modelList: RuntimeModelInfo[] = [];
  let catalog: {
    providers: Array<{
      id: string;
      name: string;
      baseUrl?: string;
      headers?: Record<string, string | null>;
      dynamic: boolean;
      auth: ReturnType<ModelRuntime["getProviderAuthStatus"]>;
      models: RuntimeModelInfo[];
    }>;
    modelCount: number;
  } = { providers: [], modelCount: 0 };
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};
  const modelIcons = await readModelIcons();

  try {
    const agentDir = getAgentDir();
    const runtime = await ModelRuntime.create();
    if (refreshCatalog) {
      await runtime.refresh({ allowNetwork: true, force: true });
    }
    const available = await runtime.getAvailable();
    modelList = available.map(serializeModel);

    // Keep the selectable `modelList` auth-filtered, but expose the complete
    // credential-blind runtime catalog separately for the Models settings UI.
    // `getModels()` includes providers/models that are not currently
    // authenticated, plus models loaded from models.json and the cached pi.dev
    // catalog.
    const allModels = runtime.getModels();
    const modelsByProvider = new Map<string, RuntimeModelInfo[]>();
    for (const model of allModels) {
      const models = modelsByProvider.get(model.provider) ?? [];
      models.push(serializeModel(model));
      modelsByProvider.set(model.provider, models);
    }
    catalog = {
      providers: runtime.getProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        headers: provider.headers ? { ...provider.headers } : undefined,
        dynamic: typeof provider.refreshModels === "function",
        auth: runtime.getProviderAuthStatus(provider.id),
        models: modelsByProvider.get(provider.id) ?? [],
      })),
      modelCount: allModels.length,
    };

    for (const m of available) {
      const key = `${m.provider}:${m.id}`;
      nameMap.set(key, m.name);
      thinkingLevels[key] = getSupportedThinkingLevels(m);
      if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
    }

    const settings = SettingsManager.create(process.cwd(), agentDir);
    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    if (provider) {
      defaultModel = { provider, modelId: modelId ?? available[0]?.id ?? "" };
    }
    log.info("models loaded", {
      count: modelList.length,
      defaultProvider: defaultModel?.provider,
      defaultModelId: defaultModel?.modelId,
      refreshCatalog,
      durationMs: elapsedMs(startedAt),
    });
  } catch (error) {
    log.warn("models load failed; returning empty list", { error, durationMs: elapsedMs(startedAt) });
  }

  return Response.json({ models: Object.fromEntries(nameMap), modelList, catalog, defaultModel, thinkingLevels, thinkingLevelMaps, modelIcons });
}
