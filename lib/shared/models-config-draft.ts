/**
 * The models-config draft model: what the user has changed in `models.json`
 * but not yet saved — kept as pure functions so it can be driven from
 * `tests/unit` without a browser.
 *
 *   • `modelsConfigDraftFrom` — server payload → draft + baseline.
 *   • `isModelsConfigDirty`   — is the draft still equal to the loaded baseline?
 *   • `modelsConfigProblem`   — the one blocking problem, or null. Gates "Save".
 *   • the `with*` / `without*` helpers — the draft edits the surface performs.
 *   • selection helpers — how an edit moves the thing being viewed.
 *
 * The rule for "unsaved changes" lives here once (normalized JSON vs. the
 * baseline), instead of being re-derived by each surface that renders the
 * draft. `lib/client/models-config-store.ts` is the stateful consumer.
 */

import type { ModelEntry, ModelsJson, ProviderEntry, RuntimeModelInfo } from "./models-config";

export interface ModelsConfigDraft {
  /** The editable config — what a save would write. */
  config: ModelsJson;
  /** The config as it was read from disk, normalized. */
  baseline: ModelsJson;
}

/**
 * A model being edited through the raw-JSON view. The text is kept even while
 * it does not parse, so an unparsable edit can be repaired in place instead of
 * being silently dropped — and so the save that would skip it can be blocked.
 * `originalJson` is the model as the edit began, so Cancel can restore it after
 * a valid edit has already landed on the draft.
 */
export interface ModelsConfigRawEdit {
  providerName: string;
  index: number;
  originalJson: string;
  text: string;
}

/** The first thing that must be fixed before saving, or null. */
export type ModelsConfigProblem = {
  reason: "syntax" | "not-object";
  message: string;
};

/** Parse a model's raw-JSON text; a non-object is rejected like bad syntax. */
export function parseModelEntryJson(
  text: string,
): { ok: true; model: ModelEntry } | { ok: false; reason: "syntax" | "not-object"; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: "syntax", message: error instanceof Error ? error.message : String(error) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "not-object", message: "not a JSON object" };
  }
  const model = { ...(parsed as ModelEntry) };
  if (typeof model.id !== "string") model.id = "";
  if (model.icon === undefined || model.icon === null || model.icon === "") delete model.icon;
  return { ok: true, model };
}

/**
 * The one problem that blocks saving, or null. Only an in-flight raw-JSON edit
 * can block today: the text is what the user sees, and while it does not parse
 * it cannot be part of the payload the save would write.
 */
export function modelsConfigProblem(
  rawText: string | null | undefined,
): ModelsConfigProblem | null {
  if (!rawText) return null;
  const parsed = parseModelEntryJson(rawText);
  if (parsed.ok) return null;
  return { reason: parsed.reason, message: parsed.message };
}

/** Normalize whatever `GET /api/models-config` returned into a `ModelsJson`. */
export function normalizeModelsJson(raw: unknown): ModelsJson {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { providers: {} };
  const data = raw as ModelsJson;
  if (data.providers && typeof data.providers === "object") return data;
  return { ...data, providers: {} };
}

/** A freshly loaded draft: no edits yet, so config and baseline are the same. */
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

/**
 * Stable text for "did this change?" — sorted keys, so a value that was edited
 * and edited back compares equal regardless of key insertion order.
 */
export function canonicalModelsJson(config: ModelsJson): string {
  return JSON.stringify(sortValue(config));
}

/**
 * Whether the draft differs from the baseline it was loaded from. This is the
 * single "unsaved changes" rule the dirty badge, the close-confirm prompt and
 * the save button all read.
 */
export function isModelsConfigDirty(draft: ModelsConfigDraft): boolean {
  return canonicalModelsJson(draft.config) !== canonicalModelsJson(draft.baseline);
}

/** Add a custom provider under a unique `new-provider[-n]` name. */
export function withCustomProvider(config: ModelsJson): { config: ModelsJson; name: string } {
  let name = "new-provider";
  let n = 1;
  while (config.providers?.[name]) name = `new-provider-${n++}`;
  return {
    config: { ...config, providers: { ...(config.providers ?? {}), [name]: { api: "openai-completions" } } },
    name,
  };
}

/** Replace one provider entry in place (key unchanged). */
export function withProvider(config: ModelsJson, name: string, provider: ProviderEntry): ModelsJson {
  return { ...config, providers: { ...(config.providers ?? {}), [name]: provider } };
}

/** Rename a provider's key, preserving its position among the entries. */
export function withRenamedProvider(config: ModelsJson, oldName: string, newName: string): ModelsJson {
  const entries = Object.entries(config.providers ?? {});
  const index = entries.findIndex(([key]) => key === oldName);
  if (index === -1) return config;
  entries[index] = [newName, entries[index][1]];
  return { ...config, providers: Object.fromEntries(entries) };
}

/** Drop a provider's entry. */
export function withoutProvider(config: ModelsJson, name: string): ModelsJson {
  const providers = { ...(config.providers ?? {}) };
  delete providers[name];
  return { ...config, providers };
}

/** Append a model entry; returns its index so the caller can select it. */
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

/** Replace one model entry in place. */
export function withModel(config: ModelsJson, providerName: string, index: number, model: ModelEntry): ModelsJson {
  const provider = config.providers?.[providerName] ?? {};
  const models = [...(provider.models ?? [])];
  models[index] = model;
  return { ...config, providers: { ...(config.providers ?? {}), [providerName]: { ...provider, models } } };
}

/** Remove one model entry, dropping the `models` key when the list empties. */
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

/** Copy a runtime catalog model into an editable `ModelEntry` (add-model-from-catalog). */
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
