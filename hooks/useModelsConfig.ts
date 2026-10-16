"use client";

import { useCallback, useMemo, useState } from "react";
import {
  cloneModelFromCatalog,
  firstProviderSelection,
  isModelsConfigDirty,
  modelsConfigDraftFrom,
  renameSelection,
  withAddedModel,
  withCustomProvider,
  withModel,
  withProvider,
  withRenamedProvider,
  withoutModel,
  withoutProvider,
} from "@/lib/shared/models-config-draft";
import type {
  ApiKeyProvider,
  ModelEntry,
  ModelsJson,
  OAuthProvider,
  ProviderEntry,
  RuntimeModelInfo,
  Selection,
} from "@/lib/shared/models-config";

/**
 * Holder for the models-config surface (`~/.pi/agent/models.json` plus the
 * OAuth / API-key provider lists).
 *
 * Everything the surface needs that is not layout lives here: reading the
 * config and provider lists, the draft and its baseline, the "unsaved changes"
 * flag, the save request and its saving / saved / failed status, and the draft
 * edits. The modal renders this hook; the future panel view consumes the same
 * hook without copying the logic.
 *
 * It is a per-mount hook, not a module-level store: one open surface has no
 * cross-tab sharing, so ADR-0003 rule 1 gives it the hook shape. If the panel
 * view ends up unmounting mid-edit, lifting this to a store is that change's
 * job — not a thing to pre-build here.
 *
 * The rules themselves live in `lib/shared/models-config-draft.ts`; this file
 * is only the wiring (state, requests, timers), which ADR-0003 rule 3 leaves to
 * the manual checklist.
 */

export interface ModelsConfigController {
  loading: boolean;
  /** The editable draft — what a save would write. */
  config: ModelsJson;
  selection: Selection | null;
  /** The draft differs from the loaded baseline. */
  dirty: boolean;
  saving: boolean;
  savedOk: boolean;
  saveError: string | null;
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  /** Re-read the config and provider lists. Resolves false when the config fetch threw. */
  load: () => Promise<boolean>;
  /** PUT the whole draft. Resolves the error text when the save failed. */
  save: () => Promise<{ ok: boolean; error?: string }>;
  setSelection: (selection: Selection | null) => void;
  addCustomProvider: () => void;
  updateProvider: (name: string, provider: ProviderEntry) => void;
  renameProvider: (oldName: string, newName: string) => void;
  deleteProvider: (name: string) => void;
  addModel: (providerName: string, model?: ModelEntry) => void;
  addModelFromCatalog: (providerName: string, source: RuntimeModelInfo) => void;
  updateModel: (providerName: string, index: number, model: ModelEntry) => void;
  removeModel: (providerName: string, index: number) => void;
  reloadOAuthProviders: () => void;
  reloadApiKeyProviders: () => void;
}

const EMPTY_CONFIG: ModelsJson = { providers: {} };

interface State {
  loading: boolean;
  config: ModelsJson;
  baseline: ModelsJson;
  selection: Selection | null;
  saving: boolean;
  savedOk: boolean;
  saveError: string | null;
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
}

const INITIAL: State = {
  loading: true,
  config: EMPTY_CONFIG,
  baseline: EMPTY_CONFIG,
  selection: null,
  saving: false,
  savedOk: false,
  saveError: null,
  oauthProviders: [],
  apiKeyProviders: [],
};

export function useModelsConfig(): ModelsConfigController {
  const [state, setState] = useState<State>(INITIAL);

  const reloadOAuthProviders = useCallback(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { providers: OAuthProvider[] }) => setState((prev) => ({ ...prev, oauthProviders: d.providers })))
      .catch(() => {});
  }, []);

  const reloadApiKeyProviders = useCallback(() => {
    fetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers: ApiKeyProvider[] }) =>
        setState((prev) => ({ ...prev, apiKeyProviders: d.providers })),
      )
      .catch(() => {});
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    setState({ ...INITIAL, loading: true });
    reloadOAuthProviders();
    reloadApiKeyProviders();
    try {
      const res = await fetch("/api/models-config");
      const raw: unknown = await res.json();
      const draft = modelsConfigDraftFrom(raw);
      setState({
        ...INITIAL,
        loading: false,
        config: draft.config,
        baseline: draft.baseline,
        selection: firstProviderSelection(draft.config),
      });
      return true;
    } catch {
      setState({ ...INITIAL, loading: false });
      return false;
    }
  }, [reloadOAuthProviders, reloadApiKeyProviders]);

  const save = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    // Snapshot what we are about to write: an edit made while the PUT is in
    // flight must stay dirty against this payload, not silently become saved.
    const payload = state.config;
    setState((prev) => ({ ...prev, saving: true, savedOk: false, saveError: null }));
    try {
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || body.error) {
        const error = body.error ?? `HTTP ${res.status}`;
        setState((prev) => ({ ...prev, saving: false, saveError: error }));
        return { ok: false, error };
      }
      setState((prev) => ({ ...prev, saving: false, savedOk: true, saveError: null, baseline: payload }));
      setTimeout(() => setState((prev) => ({ ...prev, savedOk: false })), 2000);
      return { ok: true };
    } catch (e) {
      const error = String(e);
      setState((prev) => ({ ...prev, saving: false, saveError: error }));
      return { ok: false, error };
    }
  }, [state.config]);

  const dirty = isModelsConfigDirty({ config: state.config, baseline: state.baseline });

  const setSelection = useCallback((selection: Selection | null) => {
    setState((prev) => ({ ...prev, selection }));
  }, []);

  const addCustomProvider = useCallback(() => {
    setState((prev) => {
      const { config, name } = withCustomProvider(prev.config);
      return { ...prev, config, selection: { type: "provider", name } };
    });
  }, []);

  const updateProvider = useCallback((name: string, provider: ProviderEntry) => {
    setState((prev) => ({ ...prev, config: withProvider(prev.config, name, provider) }));
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    setState((prev) => ({
      ...prev,
      config: withRenamedProvider(prev.config, oldName, newName),
      selection: prev.selection ? renameSelection(prev.selection, oldName, newName) : null,
    }));
  }, []);

  const deleteProvider = useCallback((name: string) => {
    setState((prev) => {
      const config = withoutProvider(prev.config, name);
      return { ...prev, config, selection: firstProviderSelection(config) };
    });
  }, []);

  const addModel = useCallback((providerName: string, model?: ModelEntry) => {
    setState((prev) => {
      const { config, index } = withAddedModel(prev.config, providerName, model);
      return { ...prev, config, selection: { type: "model", providerName, index } };
    });
  }, []);

  const addModelFromCatalog = useCallback((providerName: string, source: RuntimeModelInfo) => {
    setState((prev) => {
      const { config, index } = withAddedModel(prev.config, providerName, cloneModelFromCatalog(source));
      return { ...prev, config, selection: { type: "model", providerName, index } };
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, model: ModelEntry) => {
    setState((prev) => ({ ...prev, config: withModel(prev.config, providerName, index, model) }));
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    setState((prev) => ({
      ...prev,
      config: withoutModel(prev.config, providerName, index),
      selection: { type: "provider", name: providerName },
    }));
  }, []);

  return useMemo(
    () => ({
      loading: state.loading,
      config: state.config,
      selection: state.selection,
      dirty,
      saving: state.saving,
      savedOk: state.savedOk,
      saveError: state.saveError,
      oauthProviders: state.oauthProviders,
      apiKeyProviders: state.apiKeyProviders,
      load,
      save,
      setSelection,
      addCustomProvider,
      updateProvider,
      renameProvider,
      deleteProvider,
      addModel,
      addModelFromCatalog,
      updateModel,
      removeModel,
      reloadOAuthProviders,
      reloadApiKeyProviders,
    }),
    [
      state,
      dirty,
      load,
      save,
      setSelection,
      addCustomProvider,
      updateProvider,
      renameProvider,
      deleteProvider,
      addModel,
      addModelFromCatalog,
      updateModel,
      removeModel,
      reloadOAuthProviders,
      reloadApiKeyProviders,
    ],
  );
}
