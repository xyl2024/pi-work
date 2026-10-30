"use client";

import { useSyncExternalStore } from "react";
import { isContentEqual } from "./shallowEqual";
import {
  fetchApiKeyProviders,
  fetchModelsConfigPayload,
  fetchOAuthProviders,
  putModelsConfig,
} from "./models-config-io";
import {
  cloneModelFromCatalog,
  isModelsConfigDirty,
  modelsConfigDraftFrom,
  modelsConfigProblem,
  parseModelEntryJson,
  withAddedModel,
  withCustomProvider,
  withModel,
  withProvider,
  withRenamedProvider,
  withoutModel,
  withoutProvider,
  type ModelsConfigProblem,
  type ModelsConfigRawEdit,
} from "@/lib/shared/models-config-draft";
import {
  MODELS_CONFIG_ROOT_PAGE,
  backModelsConfigPage as backPageStack,
  createModelsConfigPageStack,
  isModelsConfigRootPage,
  openModelsConfigPage,
  renameModelsConfigProviderPage,
  type ModelsConfigPage,
} from "@/lib/shared/models-config-pages";
import { selectModelsConfigOpenAction } from "@/lib/shared/models-config-close";
import type {
  ApiKeyProvider,
  ModelEntry,
  ModelsJson,
  OAuthProvider,
  ProviderEntry,
  RuntimeModelInfo,
} from "@/lib/shared/models-config";

export interface ModelsConfigStoreState {
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  config: ModelsJson;
  providerNames: Record<string, string>;
  baseline: ModelsJson;
  pages: ModelsConfigPage[];
  rawEdit: ModelsConfigRawEdit | null;
  saving: boolean;
  savedOk: boolean;
  saveError: string | null;
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
}

const EMPTY_CONFIG: ModelsJson = { providers: {} };

const INITIAL: ModelsConfigStoreState = {
  loading: false,
  loaded: false,
  loadError: null,
  config: EMPTY_CONFIG,
  providerNames: {},
  baseline: EMPTY_CONFIG,
  pages: [MODELS_CONFIG_ROOT_PAGE],
  rawEdit: null,
  saving: false,
  savedOk: false,
  saveError: null,
  oauthProviders: [],
  apiKeyProviders: [],
};

let state: ModelsConfigStoreState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function patch(partial: Partial<ModelsConfigStoreState>): void {
  let changed = false;
  for (const key of Object.keys(partial) as (keyof ModelsConfigStoreState)[]) {
    if (!isContentEqual(partial[key], state[key])) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...partial };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ModelsConfigStoreState {
  return state;
}

function getServerSnapshot(): ModelsConfigStoreState {
  return INITIAL;
}

export function useModelsConfigStore(): ModelsConfigStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function selectModelsConfigDirty(snapshot: ModelsConfigStoreState): boolean {
  return Object.entries(snapshot.providerNames).some(([name, text]) => text !== name)
    || isModelsConfigDirty({ config: snapshot.config, baseline: snapshot.baseline });
}

export function getModelsConfigDirty(): boolean {
  return selectModelsConfigDirty(state);
}

export function useModelsConfigDirty(): boolean {
  return useSyncExternalStore(subscribe, getModelsConfigDirty, () => false);
}

export function selectModelsConfigProblem(
  snapshot: ModelsConfigStoreState,
): ModelsConfigProblem | null {
  for (const [name, text] of Object.entries(snapshot.providerNames)) {
    const nextName = text.trim();
    if (!nextName) return { reason: "provider-name", message: "Provider name cannot be empty" };
    if (nextName !== name && Object.hasOwn(snapshot.config.providers ?? {}, nextName)) {
      return { reason: "provider-name-conflict", message: "Name already exists" };
    }
  }
  const names = Object.entries(snapshot.config.providers ?? {}).map(([name]) =>
    (snapshot.providerNames[name] ?? name).trim());
  if (new Set(names).size !== names.length) {
    return { reason: "provider-name-conflict", message: "Name already exists" };
  }
  return modelsConfigProblem(snapshot.rawEdit?.text);
}

export function reloadModelsConfigOAuthProviders(): void {
  void fetchOAuthProviders()
    .then((providers) => patch({ oauthProviders: providers }))
    .catch(() => {});
}

export function reloadModelsConfigApiKeyProviders(): void {
  void fetchApiKeyProviders()
    .then((providers) => patch({ apiKeyProviders: providers }))
    .catch(() => {});
}

async function loadFromDisk(): Promise<void> {
  patch({ loading: true, loadError: null });
  reloadModelsConfigOAuthProviders();
  reloadModelsConfigApiKeyProviders();
  try {
    const raw = await fetchModelsConfigPayload();
    const draft = modelsConfigDraftFrom(raw);
    patch({
      loading: false,
      loaded: true,
      config: draft.config,
      baseline: draft.baseline,
      pages: createModelsConfigPageStack(),
    });
  } catch (e) {
    patch({ loading: false, loadError: e instanceof Error ? e.message : String(e) });
  }
}

export function ensureModelsConfigLoaded(): void {
  if (selectModelsConfigOpenAction({ loaded: state.loaded, loading: state.loading }) === "reuse") return;
  void loadFromDisk();
}

export function releaseModelsConfigDraft(): void {
  if (state === INITIAL) return;
  state = INITIAL;
  emit();
}

export async function saveModelsConfig(): Promise<{ ok: boolean; error?: string }> {
  const problem = selectModelsConfigProblem(state);
  if (problem) return { ok: false, error: problem.message };
  const pendingNames = { ...state.providerNames };
  const renames = Object.entries(pendingNames)
    .map(([name, text]) => [name, text.trim()] as const)
    .filter(([name, nextName]) => name !== nextName);
  let payload = state.config;
  for (const [name, nextName] of renames) {
    payload = withRenamedProvider(payload, name, nextName);
  }
  patch({ saving: true, savedOk: false, saveError: null });
  try {
    const result = await putModelsConfig(payload);
    if (!result.ok) {
      const error = result.error ?? "unknown";
      patch({ saving: false, saveError: error });
      return { ok: false, error };
    }
    let config = state.config;
    let pages = state.pages;
    let rawEdit = state.rawEdit;
    const providerNames = { ...state.providerNames };
    for (const [name, nextName] of renames) {
      config = withRenamedProvider(config, name, nextName);
      pages = renameModelsConfigProviderPage(pages, name, nextName);
      if (rawEdit?.providerName === name) rawEdit = { ...rawEdit, providerName: nextName };
      const currentText = providerNames[name];
      delete providerNames[name];
      if (currentText !== undefined && currentText !== pendingNames[name]) {
        providerNames[nextName] = currentText;
      }
    }
    for (const [name, text] of Object.entries(pendingNames)) {
      if (text.trim() === name && providerNames[name] === text) delete providerNames[name];
    }
    patch({ config, pages, rawEdit, providerNames, saving: false, savedOk: true, saveError: null, baseline: payload });
    setTimeout(() => patch({ savedOk: false }), 2000);
    return { ok: true };
  } catch (e) {
    const error = String(e);
    patch({ saving: false, saveError: error });
    return { ok: false, error };
  }
}

export function openModelsConfigProvider(name: string): void {
  patch({ pages: openModelsConfigPage({ kind: "provider", name }), rawEdit: null });
}

export function openModelsConfigModel(providerName: string, index: number): void {
  patch({ pages: openModelsConfigPage({ kind: "model", providerName, index }), rawEdit: null });
}

export function openModelsConfigOAuth(providerId: string): void {
  patch({ pages: openModelsConfigPage({ kind: "oauth", providerId }), rawEdit: null });
}

export function openModelsConfigCatalog(): void {
  patch({ pages: openModelsConfigPage({ kind: "catalog" }), rawEdit: null });
}

export function openModelsConfigApiKey(providerId: string): void {
  patch({ pages: openModelsConfigPage({ kind: "apikey", providerId }), rawEdit: null });
}

export function openModelsConfigAddProvider(): void {
  patch({ pages: openModelsConfigPage({ kind: "addProvider" }), rawEdit: null });
}

export function openModelsConfigAddModelName(providerName: string): void {
  patch({ pages: openModelsConfigPage({ kind: "addModelName", providerName }), rawEdit: null });
}

export function openModelsConfigFillModel(providerName: string, index: number): void {
  patch({ pages: openModelsConfigPage({ kind: "fillModel", providerName, index }), rawEdit: null });
}

export function modelsConfigBack(): void {
  patch({ pages: backPageStack(state.pages), rawEdit: null });
}

export function escapeModelsConfig(): { closePanel: boolean } {
  if (isModelsConfigRootPage(state.pages)) return { closePanel: true };
  patch({ pages: backPageStack(state.pages), rawEdit: null });
  return { closePanel: false };
}

export function addModelsConfigCustomProvider(): void {
  const { config, name } = withCustomProvider(state.config);
  patch({ config, pages: openModelsConfigPage({ kind: "provider", name }), rawEdit: null });
}

export function updateModelsConfigProvider(name: string, provider: ProviderEntry): void {
  patch({ config: withProvider(state.config, name, provider) });
}

export function renameModelsConfigProvider(oldName: string, newName: string): void {
  patch({ providerNames: { ...state.providerNames, [oldName]: newName }, savedOk: false });
}

export function deleteModelsConfigProvider(name: string): void {
  const providerNames = { ...state.providerNames };
  delete providerNames[name];
  patch({
    providerNames,
    config: withoutProvider(state.config, name),
    pages: createModelsConfigPageStack(),
    rawEdit: null,
  });
}

export function updateModelsConfigModel(providerName: string, index: number, model: ModelEntry): void {
  patch({ config: withModel(state.config, providerName, index, model) });
}

export function addModelsConfigModel(providerName: string): void {
  const { config, index } = withAddedModel(state.config, providerName);
  patch({
    config,
    pages: openModelsConfigPage({ kind: "model", providerName, index }),
    rawEdit: null,
  });
}

export function addModelsConfigModelFromCatalog(
  providerName: string,
  source: RuntimeModelInfo,
): void {
  const { config, index } = withAddedModel(state.config, providerName, cloneModelFromCatalog(source));
  patch({
    config,
    pages: openModelsConfigPage({ kind: "model", providerName, index }),
    rawEdit: null,
  });
}

export function fillModelsConfigModelFromCatalog(
  providerName: string,
  index: number,
  source: RuntimeModelInfo,
): void {
  patch({
    config: withModel(state.config, providerName, index, cloneModelFromCatalog(source)),
    pages: backPageStack(state.pages),
    rawEdit: null,
  });
}

export function removeModelsConfigModel(providerName: string, index: number): void {
  patch({
    config: withoutModel(state.config, providerName, index),
    pages: createModelsConfigPageStack(),
    rawEdit: null,
  });
}

export function beginModelsConfigRawEdit(providerName: string, index: number, text: string): void {
  patch({ rawEdit: { providerName, index, originalJson: text, text } });
}

export function updateModelsConfigRawEdit(text: string): void {
  const rawEdit = state.rawEdit;
  if (!rawEdit) return;
  const parsed = parseModelEntryJson(text);
  patch({
    rawEdit: { ...rawEdit, text },
    config: parsed.ok
      ? withModel(state.config, rawEdit.providerName, rawEdit.index, parsed.model)
      : state.config,
  });
}

export function applyModelsConfigRawEdit(): void {
  if (!state.rawEdit) return;
  if (!parseModelEntryJson(state.rawEdit.text).ok) return;
  patch({ rawEdit: null });
}

export function cancelModelsConfigRawEdit(): void {
  const rawEdit = state.rawEdit;
  if (!rawEdit) return;
  const parsed = parseModelEntryJson(rawEdit.originalJson);
  patch({
    rawEdit: null,
    config: parsed.ok
      ? withModel(state.config, rawEdit.providerName, rawEdit.index, parsed.model)
      : state.config,
  });
}
