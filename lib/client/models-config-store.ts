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
 *
 * The legacy modal keeps its own `hooks/useModelsConfig.ts` until the收口 slice
 * deletes it; the two are deliberately separate holders so the modal's
 * read-fresh-on-open / discard-on-close semantics never touch a panel draft.
 * They share the transport through `lib/client/models-config-io.ts`.
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
  isModelsConfigDirty,
  modelsConfigDraftFrom,
  withProvider,
  withRenamedProvider,
  withoutProvider,
} from "@/lib/shared/models-config-draft";
import {
  MODELS_CONFIG_ROOT_PAGE,
  backModelsConfigPage as backPageStack,
  createModelsConfigPageStack,
  openModelsConfigPage,
  renameModelsConfigProviderPage,
  type ModelsConfigPage,
} from "@/lib/shared/models-config-pages";
import type {
  ApiKeyProvider,
  ModelsJson,
  OAuthProvider,
  ProviderEntry,
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

// ── Loading ─────────────────────────────────────────────────────────────

async function loadFromDisk(): Promise<void> {
  patch({ loading: true, loadError: null });
  void fetchOAuthProviders()
    .then((providers) => patch({ oauthProviders: providers }))
    .catch(() => {});
  void fetchApiKeyProviders()
    .then((providers) => patch({ apiKeyProviders: providers }))
    .catch(() => {});
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
 */
export function ensureModelsConfigLoaded(): void {
  if (state.loaded || state.loading) return;
  void loadFromDisk();
}

export async function saveModelsConfig(): Promise<{ ok: boolean; error?: string }> {
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
  patch({ pages: openModelsConfigPage({ kind: "provider", name }) });
}

/** Pop one level; the provider list is the floor. */
export function modelsConfigBack(): void {
  patch({ pages: backPageStack(state.pages) });
}

// ── Provider edits ──────────────────────────────────────────────────────

export function updateModelsConfigProvider(name: string, provider: ProviderEntry): void {
  patch({ config: withProvider(state.config, name, provider) });
}

export function renameModelsConfigProvider(oldName: string, newName: string): void {
  if (!newName || newName === oldName) return;
  patch({
    config: withRenamedProvider(state.config, oldName, newName),
    pages: renameModelsConfigProviderPage(state.pages, oldName, newName),
  });
}

/** Delete a provider and draw the panel back to the list. */
export function deleteModelsConfigProvider(name: string): void {
  patch({
    config: withoutProvider(state.config, name),
    pages: createModelsConfigPageStack(),
  });
}
