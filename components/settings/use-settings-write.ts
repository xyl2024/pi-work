"use client";

import { useCallback, useRef } from "react";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/hooks/useI18n";
import { setSettings, useSettings } from "@/hooks/settingsStore";
import { isContentEqual } from "@/lib/client/shallowEqual";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { SETTINGS_OWNED_KEYS, type SettingsPatch } from "@/lib/shared/settings-keys";

export interface SettingsWrite {
  next: PiWorkConfig;
  patch: SettingsPatch;
}

export function useSettingsWrite() {
  const config = useSettings();
  const configRef = useRef<PiWorkConfig | null>(config);
  configRef.current = config;
  const toast = useToast();
  const { t } = useI18n();

  const runWrite = useCallback(async ({ next, patch }: SettingsWrite): Promise<boolean> => {
    const prev = configRef.current;
    setSettings(next);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.show({ kind: "success", message: t("Settings saved") });
      return true;
    } catch (e) {
      if (prev) setSettings(prev);
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to save settings"),
      });
      return false;
    }
  }, [toast, t]);

  const apply = useCallback(
    (computeNext: (prev: PiWorkConfig) => PiWorkConfig): Promise<boolean> => {
      const prev = configRef.current;
      if (!prev) return Promise.resolve(false);
      const next = computeNext(prev);
      return runWrite({ next, patch: diffPatch(prev, next) });
    },
    [runWrite],
  );

  return { apply };
}

export function diffPatch(prev: PiWorkConfig, next: PiWorkConfig): SettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const key of SETTINGS_OWNED_KEYS) {
    if (!isContentEqual(prev[key], next[key])) patch[key] = next[key];
  }
  return patch as SettingsPatch;
}

export type SettingsApply = ReturnType<typeof useSettingsWrite>["apply"];