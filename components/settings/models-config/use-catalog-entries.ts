"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import type { CatalogModelEntry } from "@/lib/shared/catalog-search";
import type { RuntimeCatalog, RuntimeModelInfo } from "./types";

export interface ModelsApiPayload {
  catalog: RuntimeCatalog;
  modelList: RuntimeModelInfo[];
  modelIcons: Record<string, string>;
}

export interface ModelsApiState {
  data: ModelsApiPayload;
  loaded: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface ModelsApiResponse {
  catalog?: RuntimeCatalog;
  modelList?: RuntimeModelInfo[];
  modelIcons?: Record<string, string>;
}

const EMPTY_CATALOG: RuntimeCatalog = { providers: [], modelCount: 0 };

const EMPTY_PAYLOAD: ModelsApiPayload = {
  catalog: EMPTY_CATALOG,
  modelList: [],
  modelIcons: {},
};

export interface ModelsApiMessages {
  refreshSuccessKey: string;
  refreshFailureKey: string;
  loadFailureKey: string;
}

const DEFAULT_MESSAGES: ModelsApiMessages = {
  refreshSuccessKey: "Catalog refreshed",
  refreshFailureKey: "Failed to refresh models",
  loadFailureKey: "Failed to load model catalog",
};

function modelsApiUrl(refresh: boolean, providerId: string | undefined): string {
  if (!refresh) return "/api/models";
  const provider = providerId === undefined ? "" : `&provider=${encodeURIComponent(providerId)}`;
  return `/api/models?refresh=true${provider}`;
}

export function useModelsApi(input: {
  providerId?: string;
  messages?: Partial<ModelsApiMessages>;
} = {}): ModelsApiState {
  const { t } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<ModelsApiPayload>(EMPTY_PAYLOAD);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const providerId = input.providerId;
  const messages = { ...DEFAULT_MESSAGES, ...input.messages };

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch(modelsApiUrl(isRefresh, providerId), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as ModelsApiResponse;
      if (!mounted.current) return;
      setLoaded(true);
      setData({
        catalog: body.catalog ?? EMPTY_CATALOG,
        modelList: body.modelList ?? [],
        modelIcons: body.modelIcons ?? {},
      });
      if (isRefresh) toast.show({ kind: "success", message: t(messages.refreshSuccessKey) });
    } catch (e) {
      if (!mounted.current) return;
      const message = e instanceof Error && e.message ? e.message : t(isRefresh ? messages.refreshFailureKey : messages.loadFailureKey);
      setError(message);
      if (isRefresh) toast.show({ kind: "error", message });
    } finally {
      if (mounted.current) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, [providerId, t, toast, messages.refreshSuccessKey, messages.refreshFailureKey, messages.loadFailureKey]);

  useEffect(() => {
    mounted.current = true;
    void load(false);
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { data, loaded, loading, refreshing, error, refresh };
}

export interface RuntimeCatalogEntries {
  entries: CatalogModelEntry[];
  loading: boolean;
  error: string | null;
}

export function useRuntimeCatalogEntries(): RuntimeCatalogEntries {
  const { data, loading, error } = useModelsApi();
  return {
    entries: data.catalog.providers.flatMap((provider) =>
      provider.models.map((model) => ({ model, providerName: provider.name })),
    ),
    loading,
    error,
  };
}
