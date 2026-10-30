import type { SettingsSectionId } from "@/components/settings/registry";
import type { AgentRetryConfig } from "@/lib/shared/agent-settings-types";
import type { DangerousRuleSetSnapshot } from "@/lib/shared/dangerous-commands";
import type { SubagentProfile } from "@/lib/shared/subagent";

export interface AppendSystemFile {
  content: string;
  path: string;
  exists: boolean;
}

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
  read<K extends SettingsPageDataKey>(key: K): SettingsPageDataMap[K] | undefined;
  write<K extends SettingsPageDataKey>(key: K, value: SettingsPageDataMap[K]): void;
  fetch<K extends SettingsPageDataKey>(
    key: K,
    loader: () => Promise<SettingsPageDataMap[K]>,
  ): Promise<SettingsPageDataMap[K]>;
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
      const queued = running.catch(() => undefined).then(() => {
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
        values.delete(key);
        throw error;
      });

    inflight.set(key, request);
    void request.finally(() => {
      if (inflight.get(key) === request) inflight.delete(key);
    }).catch(() => {});
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
