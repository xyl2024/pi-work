"use client";

import {
  createPanelViewStore,
  type PanelViewAdapter,
  type PanelViewCloseGuard,
  type PanelViewStore,
  type PanelViewWriter,
} from "./panel-view-store";
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
import { selectModelsConfigCloseConfirm } from "@/lib/shared/models-config-close";
import type {
  ApiKeyProvider,
  ModelEntry,
  ModelsJson,
  OAuthLoginState,
  OAuthProvider,
  ProviderEntry,
  RuntimeModelInfo,
} from "@/lib/shared/models-config";
import {
  cancelActiveOAuthLogins,
  getOAuthLoginState,
  hasActiveOAuthLogin,
  subscribeOAuthLogins,
} from "./oauth-login-store";
import { OAUTH_LOGIN_IDLE } from "./oauth-login";
import { subscribeModelIconPreferences } from "./model-icon-preferences";
import type { ModelIconPreferences } from "@/lib/shared/model-icon-match";

export type ModelsConfigPage =
  | { kind: "root" }
  | { kind: "provider"; name: string }
  | { kind: "model"; providerName: string; index: number }
  | { kind: "oauth"; providerId: string }
  | { kind: "apikey"; providerId: string }
  | { kind: "catalog" }
  | { kind: "addProvider" }
  | { kind: "addModelName"; providerName: string }
  | { kind: "fillModel"; providerName: string; index: number };

export const MODELS_CONFIG_ROOT_PAGE: ModelsConfigPage = { kind: "root" };

export interface ModelsConfigViewState {
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  config: ModelsJson;
  providerNames: Record<string, string>;
  baseline: ModelsJson;
  rawEdit: ModelsConfigRawEdit | null;
  saving: boolean;
  savedOk: boolean;
  saveError: string | null;
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  oauthProviderId: string | null;
  oauthLogin: OAuthLoginState;
  oauthInProgress: boolean;
  modelIconPreferences: ModelIconPreferences;
}

const EMPTY_CONFIG: ModelsJson = { providers: {} };

const INITIAL: ModelsConfigViewState = {
  loading: false,
  loaded: false,
  loadError: null,
  config: EMPTY_CONFIG,
  providerNames: {},
  baseline: EMPTY_CONFIG,
  rawEdit: null,
  saving: false,
  savedOk: false,
  saveError: null,
  oauthProviders: [],
  apiKeyProviders: [],
  oauthProviderId: null,
  oauthLogin: OAUTH_LOGIN_IDLE,
  oauthInProgress: false,
  modelIconPreferences: {},
};

export function selectModelsConfigDirty(state: ModelsConfigViewState): boolean {
  return Object.entries(state.providerNames).some(([name, text]) => text !== name)
    || isModelsConfigDirty({ config: state.config, baseline: state.baseline });
}

export function selectModelsConfigProblem(
  state: ModelsConfigViewState,
): ModelsConfigProblem | null {
  for (const [name, text] of Object.entries(state.providerNames)) {
    const nextName = text.trim();
    if (!nextName) return { reason: "provider-name", message: "Provider name cannot be empty" };
    if (nextName !== name && Object.hasOwn(state.config.providers ?? {}, nextName)) {
      return { reason: "provider-name-conflict", message: "Name already exists" };
    }
  }
  const names = Object.entries(state.config.providers ?? {}).map(([name]) =>
    (state.providerNames[name] ?? name).trim());
  if (new Set(names).size !== names.length) {
    return { reason: "provider-name-conflict", message: "Name already exists" };
  }
  return modelsConfigProblem(state.rawEdit?.text);
}

function baseStackFor(page: ModelsConfigPage): ModelsConfigPage[] {
  switch (page.kind) {
    case "root":
      return [];
    case "model":
    case "addModelName":
      return [MODELS_CONFIG_ROOT_PAGE, { kind: "provider", name: page.providerName }];
    case "fillModel":
      return [
        MODELS_CONFIG_ROOT_PAGE,
        { kind: "provider", name: page.providerName },
        { kind: "model", providerName: page.providerName, index: page.index },
      ];
    default:
      return [MODELS_CONFIG_ROOT_PAGE];
  }
}

function sameStack(pages: readonly ModelsConfigPage[], stack: readonly ModelsConfigPage[]): boolean {
  if (pages.length !== stack.length) return false;
  return pages.every((page, index) => isContentEqual(page, stack[index]));
}

function replacePages(pages: readonly ModelsConfigPage[]): void {
  if (sameStack(modelsConfigPanel.pages(), pages)) return;
  modelsConfigPanel.resetPages();
  for (const page of pages.slice(1)) modelsConfigPanel.openPage(page);
}

function openPanelPage(page: ModelsConfigPage): void {
  if (page.kind === "root") {
    modelsConfigPanel.resetPages();
    return;
  }
  const base = baseStackFor(page);
  const pages = modelsConfigPanel.pages();
  if (sameStack(pages.slice(0, base.length), base)) {
    modelsConfigPanel.openPage(page);
    return;
  }
  replacePages([...base, page]);
}

function renameProviderPage(
  pages: readonly ModelsConfigPage[],
  oldName: string,
  newName: string,
): ModelsConfigPage[] {
  return pages.map((page) => {
    if (page.kind === "provider" && page.name === oldName) return { kind: "provider", name: newName };
    if (page.kind === "model" && page.providerName === oldName) return { ...page, providerName: newName };
    if (page.kind === "addModelName" && page.providerName === oldName) return { ...page, providerName: newName };
    if (page.kind === "fillModel" && page.providerName === oldName) return { ...page, providerName: newName };
    return page;
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

let unsubscribeOAuth: (() => void) | null = null;
let unsubscribeModelIcons: (() => void) | null = null;

function patchOAuthPhase(writer: PanelViewWriter<ModelsConfigViewState, ModelsConfigPage>): void {
  const providerId = writer.get().oauthProviderId;
  writer.patch({
    oauthInProgress: hasActiveOAuthLogin(),
    oauthLogin: providerId ? getOAuthLoginState(providerId) : OAUTH_LOGIN_IDLE,
  });
}

const modelsConfigAdapter: PanelViewAdapter<ModelsConfigViewState, ModelsConfigPage, void, string> = {
  kind: "modelsConfig",
  initial: INITIAL,
  rootPage: MODELS_CONFIG_ROOT_PAGE,
  loadPolicy: "once",
  key: () => "models-config",
  start(writer) {
    unsubscribeOAuth?.();
    unsubscribeOAuth = subscribeOAuthLogins(() => patchOAuthPhase(writer));
    unsubscribeModelIcons?.();
    unsubscribeModelIcons = subscribeModelIconPreferences((modelIconPreferences) => {
      writer.patch({ modelIconPreferences });
    });
    patchOAuthPhase(writer);
  },
  stop() {
    unsubscribeOAuth?.();
    unsubscribeOAuth = null;
    unsubscribeModelIcons?.();
    unsubscribeModelIcons = null;
  },
  async load(_key, { patch, signal }) {
    patch({ loading: true, loadError: null });
    void fetchOAuthProviders()
      .then((oauthProviders) => patch({ oauthProviders }))
      .catch(() => {});
    void fetchApiKeyProviders()
      .then((apiKeyProviders) => patch({ apiKeyProviders }))
      .catch(() => {});
    try {
      const raw = await fetchModelsConfigPayload();
      if (signal.aborted) return;
      const draft = modelsConfigDraftFrom(raw);
      patch({
        loading: false,
        loaded: true,
        config: draft.config,
        baseline: draft.baseline,
      });
    } catch (e) {
      if (signal.aborted) return;
      patch({ loading: false, loadError: errorMessage(e) });
    }
  },
  release() {
    cancelActiveOAuthLogins();
  },
  afterBack({ writer }) {
    writer.patch({ rawEdit: null });
  },
  guard(state): PanelViewCloseGuard | null {
    const confirm = selectModelsConfigCloseConfirm({
      dirty: selectModelsConfigDirty(state),
      oauthInProgress: state.oauthInProgress,
    });
    if (!confirm) return null;
    return { ...confirm, discard: cancelActiveOAuthLogins };
  },
  status(state) {
    return selectModelsConfigDirty(state);
  },
  isRootPage(pages) {
    return pages.length <= 1;
  },
  isSiblingPage(next, current) {
    return next.kind !== "root" && next.kind === current.kind;
  },
};

export const modelsConfigPanel: PanelViewStore<ModelsConfigViewState, ModelsConfigPage, void> =
  createPanelViewStore(modelsConfigAdapter);

export function useModelsConfigPanel() {
  return modelsConfigPanel.useSnapshot();
}

export function reloadModelsConfigOAuthProviders(): void {
  const scope = modelsConfigPanel.scope();
  void fetchOAuthProviders()
    .then((oauthProviders) => scope.patch({ oauthProviders }))
    .catch(() => {});
}

export function reloadModelsConfigApiKeyProviders(): void {
  const scope = modelsConfigPanel.scope();
  void fetchApiKeyProviders()
    .then((apiKeyProviders) => scope.patch({ apiKeyProviders }))
    .catch(() => {});
}

export function applyModelsConfigModelIconPreferences(preferences: ModelIconPreferences): void {
  modelsConfigPanel.patch({ modelIconPreferences: preferences });
}

export async function saveModelsConfig(): Promise<{ ok: boolean; error?: string }> {
  const scope = modelsConfigPanel.scope();
  const state = scope.get();
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
  scope.patch({ saving: true, savedOk: false, saveError: null });
  try {
    const result = await putModelsConfig(payload);
    if (!result.ok) {
      const error = result.error ?? "unknown";
      scope.patch({ saving: false, saveError: error });
      return { ok: false, error };
    }
    const latest = scope.get();
    let config = latest.config;
    let pages = modelsConfigPanel.pages();
    let rawEdit = latest.rawEdit;
    const providerNames = { ...latest.providerNames };
    for (const [name, nextName] of renames) {
      config = withRenamedProvider(config, name, nextName);
      pages = renameProviderPage(pages, name, nextName);
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
    scope.patch({ config, rawEdit, providerNames, saving: false, savedOk: true, saveError: null, baseline: payload });
    replacePages(pages);
    setTimeout(() => modelsConfigPanel.patch({ savedOk: false }), 2000);
    return { ok: true };
  } catch (e) {
    const error = String(e);
    scope.patch({ saving: false, saveError: error });
    return { ok: false, error };
  }
}

export function openModelsConfigProvider(name: string): void {
  openPanelPage({ kind: "provider", name });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function openModelsConfigModel(providerName: string, index: number): void {
  openPanelPage({ kind: "model", providerName, index });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function openModelsConfigOAuth(providerId: string): void {
  modelsConfigPanel.patch({
    oauthProviderId: providerId,
    oauthLogin: getOAuthLoginState(providerId),
    oauthInProgress: hasActiveOAuthLogin(),
  });
  openPanelPage({ kind: "oauth", providerId });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function openModelsConfigCatalog(): void {
  openPanelPage({ kind: "catalog" });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function openModelsConfigApiKey(providerId: string): void {
  openPanelPage({ kind: "apikey", providerId });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function openModelsConfigAddProvider(): void {
  openPanelPage({ kind: "addProvider" });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function openModelsConfigAddModelName(providerName: string): void {
  openPanelPage({ kind: "addModelName", providerName });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function openModelsConfigFillModel(providerName: string, index: number): void {
  openPanelPage({ kind: "fillModel", providerName, index });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function addModelsConfigCustomProvider(): void {
  const { config, name } = withCustomProvider(modelsConfigPanel.get().config);
  modelsConfigPanel.patch({ config });
  openPanelPage({ kind: "provider", name });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function updateModelsConfigProvider(name: string, provider: ProviderEntry): void {
  const state = modelsConfigPanel.get();
  modelsConfigPanel.patch({ config: withProvider(state.config, name, provider) });
}

export function renameModelsConfigProvider(oldName: string, newName: string): void {
  const state = modelsConfigPanel.get();
  modelsConfigPanel.patch({ providerNames: { ...state.providerNames, [oldName]: newName }, savedOk: false });
}

export function deleteModelsConfigProvider(name: string): void {
  const state = modelsConfigPanel.get();
  const providerNames = { ...state.providerNames };
  delete providerNames[name];
  modelsConfigPanel.patch({
    providerNames,
    config: withoutProvider(state.config, name),
    rawEdit: null,
  });
  modelsConfigPanel.resetPages();
}

export function updateModelsConfigModel(providerName: string, index: number, model: ModelEntry): void {
  const state = modelsConfigPanel.get();
  modelsConfigPanel.patch({ config: withModel(state.config, providerName, index, model) });
}

export function addModelsConfigModel(providerName: string): void {
  const { config, index } = withAddedModel(modelsConfigPanel.get().config, providerName);
  modelsConfigPanel.patch({ config });
  openPanelPage({ kind: "model", providerName, index });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function addModelsConfigModelFromCatalog(
  providerName: string,
  source: RuntimeModelInfo,
): void {
  const { config, index } = withAddedModel(
    modelsConfigPanel.get().config,
    providerName,
    cloneModelFromCatalog(source),
  );
  modelsConfigPanel.patch({ config });
  openPanelPage({ kind: "model", providerName, index });
  modelsConfigPanel.patch({ rawEdit: null });
}

export function fillModelsConfigModelFromCatalog(
  providerName: string,
  index: number,
  source: RuntimeModelInfo,
): void {
  const state = modelsConfigPanel.get();
  modelsConfigPanel.patch({
    config: withModel(state.config, providerName, index, cloneModelFromCatalog(source)),
  });
  modelsConfigPanel.back();
}

export function removeModelsConfigModel(providerName: string, index: number): void {
  const state = modelsConfigPanel.get();
  modelsConfigPanel.patch({ config: withoutModel(state.config, providerName, index), rawEdit: null });
  modelsConfigPanel.resetPages();
}

export function beginModelsConfigRawEdit(providerName: string, index: number, text: string): void {
  modelsConfigPanel.patch({ rawEdit: { providerName, index, originalJson: text, text } });
}

export function updateModelsConfigRawEdit(text: string): void {
  const state = modelsConfigPanel.get();
  const rawEdit = state.rawEdit;
  if (!rawEdit) return;
  const parsed = parseModelEntryJson(text);
  modelsConfigPanel.patch({
    rawEdit: { ...rawEdit, text },
    config: parsed.ok
      ? withModel(state.config, rawEdit.providerName, rawEdit.index, parsed.model)
      : state.config,
  });
}

export function applyModelsConfigRawEdit(): void {
  const rawEdit = modelsConfigPanel.get().rawEdit;
  if (!rawEdit) return;
  if (!parseModelEntryJson(rawEdit.text).ok) return;
  modelsConfigPanel.patch({ rawEdit: null });
}

export function cancelModelsConfigRawEdit(): void {
  const state = modelsConfigPanel.get();
  const rawEdit = state.rawEdit;
  if (!rawEdit) return;
  const parsed = parseModelEntryJson(rawEdit.originalJson);
  modelsConfigPanel.patch({
    rawEdit: null,
    config: parsed.ok
      ? withModel(state.config, rawEdit.providerName, rawEdit.index, parsed.model)
      : state.config,
  });
}
