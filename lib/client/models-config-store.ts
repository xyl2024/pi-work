"use client";

/**
 * Module-scoped holder for the models-config *panel view*.
 *
 * The panel card only renders the active tab's body, so switching panel tabs
 * unmounts the view. Everything the user would notice losing — the draft, the
 * page-stack position, the OAuth / API-key provider lists — therefore has to
 * live outside that mount. That is the whole reason this module exists; ADR-0003
 * rule 1 gives a concern a module-level store only when its state must outlive
 * a single mount, and this is exactly that case.
 *
 * The rules stay pure and live in `lib/shared/models-config-draft.ts` (draft,
 * dirty) and `lib/shared/models-config-pages.ts` (page stack). This file is only
 * the wiring — requests, the `useSyncExternalStore` subscription, the "first
 * open loads, later opens keep the draft" policy — which ADR-0003 rule 3 leaves
 * to the manual checklist.
 */

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
  /** A read is in flight (first open only — later opens reuse the draft). */
  loading: boolean;
  /** At least one read has completed, so `config` / `baseline` are real. */
  loaded: boolean;
  /** The last read failed; the panel shows this instead of the list. */
  loadError: string | null;
  config: ModelsJson;
  baseline: ModelsJson;
  pages: ModelsConfigPage[];
  /** The model being edited through the raw-JSON view, if any. */
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

/** Content-equality guarded write — a no-op patch never re-renders. */
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

/** The single "unsaved changes" rule, read from one snapshot. */
export function selectModelsConfigDirty(snapshot: ModelsConfigStoreState): boolean {
  return isModelsConfigDirty({ config: snapshot.config, baseline: snapshot.baseline });
}

/** Non-reactive read of the same rule — the close guard asks at confirm time. */
export function getModelsConfigDirty(): boolean {
  return selectModelsConfigDirty(state);
}

/**
 * Subscribe to just the dirty flag (the right-bar badge). A boolean snapshot
 * keeps the shell from re-rendering on every other store change.
 */
export function useModelsConfigDirty(): boolean {
  return useSyncExternalStore(subscribe, getModelsConfigDirty, () => false);
}

/** The single "cannot save yet" rule — the save bar and the raw editor read it. */
export function selectModelsConfigProblem(
  snapshot: ModelsConfigStoreState,
): ModelsConfigProblem | null {
  return modelsConfigProblem(snapshot.rawEdit?.text);
}

// ── Loading ─────────────────────────────────────────────────────────────

/** Re-read the subscription provider list (after an OAuth login / logout). */
export function reloadModelsConfigOAuthProviders(): void {
  void fetchOAuthProviders()
    .then((providers) => patch({ oauthProviders: providers }))
    .catch(() => {});
}

/** Re-read the API-key provider list (after a key is saved / removed). */
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

/**
 * Read the config the first time the panel opens. Later opens reuse the draft
 * and the page stack, so a panel collapse or a tab switch never loses edits.
 * The draft is released when the tab closes (`releaseModelsConfigDraft`), which
 * is what makes the next open read disk again — see
 * `selectModelsConfigOpenAction` in lib/shared/models-config-close.ts.
 */
export function ensureModelsConfigLoaded(): void {
  if (selectModelsConfigOpenAction({ loaded: state.loaded, loading: state.loading }) === "reuse") return;
  void loadFromDisk();
}

/**
 * Throw the draft away. Called by the shell when the models-config tab closes:
 * the tab is the lifetime of the draft in #109's model, so the next open reads
 * disk and rebuilds the page stack instead of resurrecting discarded edits.
 * Collapsing the panel or switching tabs does not close the tab, so it never
 * lands here.
 */
export function releaseModelsConfigDraft(): void {
  if (state === INITIAL) return;
  state = INITIAL;
  emit();
}

export async function saveModelsConfig(): Promise<{ ok: boolean; error?: string }> {
  // An in-flight raw edit that does not parse is not part of the draft; saving
  // around it would drop it silently.
  const problem = modelsConfigProblem(state.rawEdit?.text);
  if (problem) return { ok: false, error: problem.message };
  // Snapshot what we are about to write: an edit made while the PUT is in
  // flight must stay dirty against this payload, not silently become saved.
  const payload = state.config;
  patch({ saving: true, savedOk: false, saveError: null });
  try {
    const result = await putModelsConfig(payload);
    if (!result.ok) {
      const error = result.error ?? "unknown";
      patch({ saving: false, saveError: error });
      return { ok: false, error };
    }
    patch({ saving: false, savedOk: true, saveError: null, baseline: payload });
    setTimeout(() => patch({ savedOk: false }), 2000);
    return { ok: true };
  } catch (e) {
    const error = String(e);
    patch({ saving: false, saveError: error });
    return { ok: false, error };
  }
}

// ── Navigation ──────────────────────────────────────────────────────────

/** Open a provider's detail page (replacing a sibling detail page). */
export function openModelsConfigProvider(name: string): void {
  patch({ pages: openModelsConfigPage({ kind: "provider", name }), rawEdit: null });
}

/** Open a model's detail page (a sibling of the provider page). */
export function openModelsConfigModel(providerName: string, index: number): void {
  patch({ pages: openModelsConfigPage({ kind: "model", providerName, index }), rawEdit: null });
}

/** Open a subscription (OAuth) provider's detail page. */
export function openModelsConfigOAuth(providerId: string): void {
  patch({ pages: openModelsConfigPage({ kind: "oauth", providerId }), rawEdit: null });
}

/** Open the read-only model catalog as a root-level sibling of the list. */
export function openModelsConfigCatalog(): void {
  patch({ pages: openModelsConfigPage({ kind: "catalog" }), rawEdit: null });
}

/** Open an API-key provider's detail page. */
export function openModelsConfigApiKey(providerId: string): void {
  patch({ pages: openModelsConfigPage({ kind: "apikey", providerId }), rawEdit: null });
}

/** Open the add-provider picker above the list. */
export function openModelsConfigAddProvider(): void {
  patch({ pages: openModelsConfigPage({ kind: "addProvider" }), rawEdit: null });
}

/** Open the "name a model" catalog search above the provider page. */
export function openModelsConfigAddModelName(providerName: string): void {
  patch({ pages: openModelsConfigPage({ kind: "addModelName", providerName }), rawEdit: null });
}

/** Open the "fill this model from the catalog" picker above the model page. */
export function openModelsConfigFillModel(providerName: string, index: number): void {
  patch({ pages: openModelsConfigPage({ kind: "fillModel", providerName, index }), rawEdit: null });
}

/** Pop one level; the provider list is the floor. */
export function modelsConfigBack(): void {
  patch({ pages: backPageStack(state.pages), rawEdit: null });
}

/**
 * Run Escape against the page stack: pop one level, or — when the list is
 * already on top — report that the panel tab is free to run its close rules.
 */
export function escapeModelsConfig(): { closePanel: boolean } {
  if (isModelsConfigRootPage(state.pages)) return { closePanel: true };
  patch({ pages: backPageStack(state.pages), rawEdit: null });
  return { closePanel: false };
}

// ── Provider edits ──────────────────────────────────────────────────────

/** Create a custom provider under a free name and open its detail page. */
export function addModelsConfigCustomProvider(): void {
  const { config, name } = withCustomProvider(state.config);
  patch({ config, pages: openModelsConfigPage({ kind: "provider", name }), rawEdit: null });
}

export function updateModelsConfigProvider(name: string, provider: ProviderEntry): void {
  patch({ config: withProvider(state.config, name, provider) });
}

export function renameModelsConfigProvider(oldName: string, newName: string): void {
  if (!newName || newName === oldName) return;
  patch({
    config: withRenamedProvider(state.config, oldName, newName),
    pages: renameModelsConfigProviderPage(state.pages, oldName, newName),
    rawEdit:
      state.rawEdit && state.rawEdit.providerName === oldName
        ? { ...state.rawEdit, providerName: newName }
        : state.rawEdit,
  });
}

/** Delete a provider and draw the panel back to the list. */
export function deleteModelsConfigProvider(name: string): void {
  patch({
    config: withoutProvider(state.config, name),
    pages: createModelsConfigPageStack(),
    rawEdit: null,
  });
}

// ── Model edits ─────────────────────────────────────────────────────────

/** Replace one model entry in place (key unchanged). */
export function updateModelsConfigModel(providerName: string, index: number, model: ModelEntry): void {
  patch({ config: withModel(state.config, providerName, index, model) });
}

/**
 * Append a model to a provider's list and open its detail page. Both the add
 * and any subsequent edit stay in the draft — only a save writes them.
 */
export function addModelsConfigModel(providerName: string): void {
  const { config, index } = withAddedModel(state.config, providerName);
  patch({
    config,
    pages: openModelsConfigPage({ kind: "model", providerName, index }),
    rawEdit: null,
  });
}

/**
 * Append a model cloned from a catalog entry and open its detail page. Like
 * `addModelsConfigModel`, the addition stays in the draft until a save.
 */
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

/** Fill an existing model's fields from a catalog entry and return to it. */
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

/** Remove a model from the draft and draw the panel back to the list. */
export function removeModelsConfigModel(providerName: string, index: number): void {
  patch({
    config: withoutModel(state.config, providerName, index),
    pages: createModelsConfigPageStack(),
    rawEdit: null,
  });
}

// ── Raw-JSON editing ────────────────────────────────────────────────────

/** Start editing a model as raw JSON, seeded with its current serialization. */
export function beginModelsConfigRawEdit(providerName: string, index: number, text: string): void {
  patch({ rawEdit: { providerName, index, originalJson: text, text } });
}

/**
 * The raw text is the editable model: a parse that succeeds lands on the draft
 * immediately (so the edit counts as unsaved and a save writes it), while a
 * parse that fails keeps the text and blocks the save through
 * `selectModelsConfigProblem`.
 */
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

/** Leave the raw view. The text is already applied on every keystroke. */
export function applyModelsConfigRawEdit(): void {
  if (!state.rawEdit) return;
  if (!parseModelEntryJson(state.rawEdit.text).ok) return;
  patch({ rawEdit: null });
}

/** Abandon the raw edit and restore the model to how it was when it began. */
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
