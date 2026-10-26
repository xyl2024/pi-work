/**
 * Page-data cache for settings pages that load their own data on mount.
 *
 * Paging unmounts the page the user leaves, so a page that fetches in an
 * effect would re-request every time it comes back and flash "Loading…" in
 * between. Each settings modal instance owns one of these caches: the first
 * entry into a page loads as usual, later entries within the same modal reuse
 * the result, and closing the modal throws the cache away (the modal builds it
 * per mount) so the next open starts from disk.
 *
 * Only successful loads are cached. A rejected load leaves nothing behind (and
 * a failed refresh drops the previous value), so the next entry retries instead
 * of showing a stale snapshot as if it were loaded. A refresh never resolves
 * with an older in-flight read: it waits for that read, then loads again, so
 * "save elsewhere, then reload" cannot show pre-save data.
 *
 * Pure data structure — no React, no browser APIs, no `fetch` — living in the
 * client layer because its state belongs to one open modal (ADR-0003's
 * 2026-09-19 revision: rule-shaped, but the input carries client-session
 * facts). `tests/unit/settings-page-cache.test.ts` drives it directly.
 */

import type { SettingsSectionId } from "@/components/settings/registry";
import type { AgentRetryConfig } from "@/lib/shared/agent-settings-types";
import type { DangerousRuleSetSnapshot } from "@/lib/shared/dangerous-commands";
import type { SubagentProfile } from "@/lib/shared/subagent";

/** The disk state of `~/.pi/agent/APPEND_SYSTEM.md`, as `/api/append-system` returns it. */
export interface AppendSystemFile {
  content: string;
  path: string;
  exists: boolean;
}

/**
 * Pages whose mount-time load is cached for the lifetime of one settings
 * modal, and the payload each one caches.
 *
 * `satisfies readonly SettingsSectionId[]` pins every key to the settings
 * registry: renaming or removing a section id breaks compilation here, and a
 * key without a payload type in `SettingsPageDataMap` breaks the `read` /
 * `write` / `fetch` signatures.
 */
export const SETTINGS_PAGE_DATA_KEYS = [
  "append-system",
  "dangerous-commands",
  "subagent",
  "retry",
] as const satisfies readonly SettingsSectionId[];

export type SettingsPageDataKey = (typeof SETTINGS_PAGE_DATA_KEYS)[number];

export interface SettingsPageDataMap {
  "append-system": AppendSystemFile;
  "dangerous-commands": DangerousRuleSetSnapshot;
  subagent: SubagentProfile[];
  retry: AgentRetryConfig;
}

export interface SettingsPageDataCache {
  /** The last successfully loaded value for `key`, if any. */
  read<K extends SettingsPageDataKey>(key: K): SettingsPageDataMap[K] | undefined;
  /** Replace the cached value (a save/mutation), without a request. */
  write<K extends SettingsPageDataKey>(key: K, value: SettingsPageDataMap[K]): void;
  /**
   * Return the cached value if there is one; otherwise run `loader` (sharing
   * an in-flight request for the same key) and cache its result.
   */
  fetch<K extends SettingsPageDataKey>(
    key: K,
    loader: () => Promise<SettingsPageDataMap[K]>,
  ): Promise<SettingsPageDataMap[K]>;
  /**
   * Run `loader` even when a value is cached (used after a write elsewhere, so
   * the page never keeps a stale snapshot). If a read for the same key is
   * already in flight, wait for it and then load again: the forced read must
   * not resolve with the older response. Failures drop the cached value.
   */
  refresh<K extends SettingsPageDataKey>(
    key: K,
    loader: () => Promise<SettingsPageDataMap[K]>,
  ): Promise<SettingsPageDataMap[K]>;
}

export function createSettingsPageCache(): SettingsPageDataCache {
  const values = new Map<SettingsPageDataKey, unknown>();
  const inflight = new Map<SettingsPageDataKey, Promise<unknown>>();

  function load<K extends SettingsPageDataKey>(
    key: K,
    loader: () => Promise<SettingsPageDataMap[K]>,
    force: boolean,
  ): Promise<SettingsPageDataMap[K]> {
    const running = inflight.get(key);
    if (running) {
      if (!force) return running as Promise<SettingsPageDataMap[K]>;
      // Wait for the older read to settle, then read again — a forced refresh
      // must not resolve with a response that predates the caller's write.
      const queued = running.catch(() => undefined).then(() => {
        // Nothing else can own the slot while this queue entry is in it, so
        // clearing it here is safe. It has to go before `load` runs, or the
        // recursive call would wait on this very promise.
        inflight.delete(key);
        return load(key, loader, true);
      });
      inflight.set(key, queued);
      return queued;
    }

    if (!force && values.has(key)) {
      return Promise.resolve(values.get(key) as SettingsPageDataMap[K]);
    }

    const request = loader()
      .then((value) => {
        values.set(key, value);
        return value;
      })
      .catch((error: unknown) => {
        // A failed load is not data: never let it sit in the cache as if it
        // were. A failed refresh also invalidates the value it could not
        // replace, so leaving the page and coming back retries.
        values.delete(key);
        throw error;
      });

    // Only clear our own slot: a forced refresh may already have queued a
    // follow-up behind this request, and that one must stay shareable.
    inflight.set(key, request);
    void request.finally(() => {
      if (inflight.get(key) === request) inflight.delete(key);
    }).catch(() => { /* the request's own rejection is the caller's */ });
    return request;
  }

  return {
    read<K extends SettingsPageDataKey>(key: K): SettingsPageDataMap[K] | undefined {
      return values.get(key) as SettingsPageDataMap[K] | undefined;
    },
    write<K extends SettingsPageDataKey>(key: K, value: SettingsPageDataMap[K]): void {
      values.set(key, value);
    },
    fetch<K extends SettingsPageDataKey>(
      key: K,
      loader: () => Promise<SettingsPageDataMap[K]>,
    ): Promise<SettingsPageDataMap[K]> {
      return load(key, loader, false);
    },
    refresh<K extends SettingsPageDataKey>(
      key: K,
      loader: () => Promise<SettingsPageDataMap[K]>,
    ): Promise<SettingsPageDataMap[K]> {
      return load(key, loader, true);
    },
  };
}
