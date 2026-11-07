import type { ModelEntry, ModelsJson, ProviderEntry, RuntimeModelInfo } from "./models-config";

export interface ModelsConfigDraft {
  config: ModelsJson;
  baseline: ModelsJson;
}

export interface ModelsConfigRawEdit {
  providerName: string;
  index: number;
  originalJson: string;
  text: string;
}

export type ModelsConfigProblemReason =
  | "syntax"
  | "not-object"
  | "provider-name"
  | "provider-name-conflict"
  | "empty-model-id";

export interface ModelsConfigProblemLocation {
  providerName: string | null;
  index: number | null;
}

export type ModelsConfigProblem = {
  reason: ModelsConfigProblemReason;
  message: string;
  location: ModelsConfigProblemLocation;
};

const NO_LOCATION: ModelsConfigProblemLocation = { providerName: null, index: null };

export function modelsConfigProblemAt(
  reason: ModelsConfigProblemReason,
  message: string,
  location: ModelsConfigProblemLocation = NO_LOCATION,
): ModelsConfigProblem {
  return { reason, message, location };
}

export function parseRawObjectJson(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: "syntax" | "not-object"; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: "syntax", message: error instanceof Error ? error.message : String(error) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "not-object", message: "not a JSON object" };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

export function parseModelEntryJson(
  text: string,
): { ok: true; model: ModelEntry } | { ok: false; reason: "syntax" | "not-object"; message: string } {
  const parsed = parseRawObjectJson(text);
  if (!parsed.ok) return parsed;
  const model = { ...(parsed.value as unknown as ModelEntry) };
  if (typeof model.id !== "string") model.id = "";
  if (model.icon === undefined || model.icon === null || model.icon === "") delete model.icon;
  return { ok: true, model };
}

export function parseProviderEntryJson(
  text: string,
): { ok: true; provider: ProviderEntry } | { ok: false; reason: "syntax" | "not-object"; message: string } {
  const parsed = parseRawObjectJson(text);
  if (!parsed.ok) return parsed;
  return { ok: true, provider: { ...(parsed.value as ProviderEntry) } };
}

export function modelsConfigProblem(
  rawText: string | null | undefined,
  providerName: string | null = null,
): ModelsConfigProblem | null {
  if (!rawText) return null;
  const parsed = parseRawObjectJson(rawText);
  if (parsed.ok) return null;
  return modelsConfigProblemAt(parsed.reason, parsed.message, { providerName, index: null });
}

export function missingModelIdProblem(config: ModelsJson): ModelsConfigProblem | null {
  for (const [providerName, provider] of Object.entries(config.providers ?? {})) {
    const models = provider?.models ?? [];
    for (let index = 0; index < models.length; index += 1) {
      const id = models[index]?.id;
      if (typeof id !== "string" || !id.trim()) {
        return modelsConfigProblemAt("empty-model-id", "Model ID cannot be empty", { providerName, index });
      }
    }
  }
  return null;
}

export function normalizeModelsJson(raw: unknown): ModelsJson {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { providers: {} };
  const data = raw as ModelsJson;
  if (data.providers && typeof data.providers === "object") return data;
  return { ...data, providers: {} };
}

export function modelsConfigDraftFrom(raw: unknown): ModelsConfigDraft {
  const baseline = normalizeModelsJson(raw);
  return { config: baseline, baseline };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = sortValue(record[key]);
  return sorted;
}

function canonicalValue(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? "undefined";
}

export function canonicalModelsJson(config: ModelsJson): string {
  return canonicalValue(config);
}

export function modelsConfigChangedProviders(draft: ModelsConfigDraft): string[] {
  const configProviders = draft.config.providers ?? {};
  const baselineProviders = draft.baseline.providers ?? {};
  const names = new Set([...Object.keys(configProviders), ...Object.keys(baselineProviders)]);
  return [...names]
    .filter((name) => canonicalValue(configProviders[name]) !== canonicalValue(baselineProviders[name]))
    .sort();
}

export function modelsConfigChangeCount(draft: ModelsConfigDraft): number {
  return modelsConfigChangedProviders(draft).length;
}

export function isModelsConfigDirty(draft: ModelsConfigDraft): boolean {
  return canonicalModelsJson(draft.config) !== canonicalModelsJson(draft.baseline);
}

export function withCustomProvider(config: ModelsJson): { config: ModelsJson; name: string } {
  let name = "new-provider";
  let n = 1;
  while (config.providers?.[name]) name = `new-provider-${n++}`;
  return {
    config: { ...config, providers: { ...(config.providers ?? {}), [name]: { api: "openai-completions" } } },
    name,
  };
}

export function withProvider(config: ModelsJson, name: string, provider: ProviderEntry): ModelsJson {
  return { ...config, providers: { ...(config.providers ?? {}), [name]: provider } };
}

export function withRenamedProvider(config: ModelsJson, oldName: string, newName: string): ModelsJson {
  const entries = Object.entries(config.providers ?? {});
  const index = entries.findIndex(([key]) => key === oldName);
  if (index === -1) return config;
  entries[index] = [newName, entries[index][1]];
  return { ...config, providers: Object.fromEntries(entries) };
}

export function withoutProvider(config: ModelsJson, name: string): ModelsJson {
  const providers = { ...(config.providers ?? {}) };
  delete providers[name];
  return { ...config, providers };
}

export function withAddedModel(
  config: ModelsJson,
  providerName: string,
  model?: ModelEntry,
): { config: ModelsJson; index: number } {
  const provider = config.providers?.[providerName] ?? {};
  const models = [...(provider.models ?? []), model ?? { id: "" }];
  return {
    config: { ...config, providers: { ...(config.providers ?? {}), [providerName]: { ...provider, models } } },
    index: models.length - 1,
  };
}

export function withModel(config: ModelsJson, providerName: string, index: number, model: ModelEntry): ModelsJson {
  const provider = config.providers?.[providerName] ?? {};
  const models = [...(provider.models ?? [])];
  models[index] = model;
  return { ...config, providers: { ...(config.providers ?? {}), [providerName]: { ...provider, models } } };
}

export function withoutModel(config: ModelsJson, providerName: string, index: number): ModelsJson {
  const provider = config.providers?.[providerName] ?? {};
  const models = [...(provider.models ?? [])];
  models.splice(index, 1);
  return {
    ...config,
    providers: {
      ...(config.providers ?? {}),
      [providerName]: { ...provider, models: models.length ? models : undefined },
    },
  };
}

export function cloneModelFromCatalog(source: RuntimeModelInfo): ModelEntry {
  return {
    id: source.id,
    name: source.name,
    api: source.api,
    reasoning: source.reasoning,
    thinkingLevelMap: source.thinkingLevelMap ? { ...source.thinkingLevelMap } : undefined,
    input: [...source.input],
    contextWindow: source.contextWindow,
    maxTokens: source.maxTokens,
    cost: {
      input: source.cost.input,
      output: source.cost.output,
      cacheRead: source.cost.cacheRead,
      cacheWrite: source.cost.cacheWrite,
      tiers: source.cost.tiers ? [...source.cost.tiers] : undefined,
    },
    compat: source.compat ? { ...source.compat } : undefined,
  };
}
