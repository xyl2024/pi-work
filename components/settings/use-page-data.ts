"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SettingsPageDataCache,
  SettingsPageDataKey,
  SettingsPageDataMap,
} from "@/lib/client/settings-page-cache";

export interface SettingsPageData<K extends SettingsPageDataKey> {
  data: SettingsPageDataMap[K] | undefined;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  mutate: (
    next:
      | SettingsPageDataMap[K]
      | ((prev: SettingsPageDataMap[K] | undefined) => SettingsPageDataMap[K]),
  ) => void;
}

export function useSettingsPageData<K extends SettingsPageDataKey>(
  cache: SettingsPageDataCache,
  key: K,
  loader: () => Promise<SettingsPageDataMap[K]>,
): SettingsPageData<K> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const mountedRef = useRef(false);
  const [data, setData] = useState<SettingsPageDataMap[K] | undefined>(() => cache.read(key));
  const [loading, setLoading] = useState(() => cache.read(key) === undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((mode: "fetch" | "refresh"): Promise<void> => {
    setError(null);
    if (cache.read(key) === undefined) setLoading(true);

    const run = () => loaderRef.current();
    const request = mode === "fetch" ? cache.fetch(key, run) : cache.refresh(key, run);
    return request.then(
      (value) => {
        if (!mountedRef.current) return;
        setData(value);
        setLoading(false);
      },
      (reason: unknown) => {
        if (!mountedRef.current) return;
        setError(reason instanceof Error && reason.message ? reason.message : String(reason));
        setLoading(false);
      },
    );
  }, [cache, key]);

  useEffect(() => {
    mountedRef.current = true;
    void load("fetch");
    return () => { mountedRef.current = false; };
  }, [load]);

  const reload = useCallback(() => load("refresh"), [load]);

  const mutate = useCallback<SettingsPageData<K>["mutate"]>((next) => {
    const value = typeof next === "function"
      ? (next as (prev: SettingsPageDataMap[K] | undefined) => SettingsPageDataMap[K])(cache.read(key))
      : next;
    cache.write(key, value);
    setData(value);
    setLoading(false);
    setError(null);
  }, [cache, key]);

  return { data, loading, error, reload, mutate };
}
