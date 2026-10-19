"use client";

/**
 * Hook over the settings page-data cache (`lib/client/settings-page-cache.ts`).
 * Pages still unmount when the user switches away (that is what makes "leave
 * the page = drop the draft" honest), but the data they loaded is kept for the
 * rest of the modal's lifetime. On a later entry the hook starts from the
 * cached value — no request, no "Loading…" flash — and only the first entry
 * (or an explicit `reload`) talks to the server.
 *
 * `mutate` is the write side: after a save the page hands the new value here so
 * a later re-entry shows it instead of the pre-save snapshot. `reload` is for
 * data edited elsewhere (e.g. the subagent editor): it re-fetches, replaces the
 * cache and resolves once the shown value is up to date.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SettingsPageDataCache,
  SettingsPageDataKey,
  SettingsPageDataMap,
} from "@/lib/client/settings-page-cache";

export interface SettingsPageData<K extends SettingsPageDataKey> {
  /** Cached or freshly loaded value; undefined until the first successful load. */
  data: SettingsPageDataMap[K] | undefined;
  /** True only while there is no value to show yet (never flashes on re-entry). */
  loading: boolean;
  /** The last load error, cleared when a load starts. */
  error: string | null;
  /**
   * Force a fresh request and resolve once the result is shown. The currently
   * displayed value stays on screen while the request is in flight.
   */
  reload: () => Promise<void>;
  /** Update the shown value and the cache together (a save made by this page). */
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
  // The loader closes over component state (config, i18n). Keep the latest one
  // in a ref so a new closure does not re-trigger a load.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const mountedRef = useRef(false);
  const [data, setData] = useState<SettingsPageDataMap[K] | undefined>(() => cache.read(key));
  const [loading, setLoading] = useState(() => cache.read(key) === undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((mode: "fetch" | "refresh"): Promise<void> => {
    setError(null);
    // The cache decides whether `fetch` touches the network. Here we only
    // decide whether there is anything to show while it resolves: a re-entry
    // starts from the cached value, so it never takes the loading state.
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
