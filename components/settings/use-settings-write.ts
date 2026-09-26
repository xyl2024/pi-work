"use client";

import { useCallback, useRef } from "react";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/hooks/useI18n";
import { setSettings, useSettings } from "@/hooks/settingsStore";
import { isContentEqual } from "@/lib/client/shallowEqual";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { SETTINGS_OWNED_KEYS, type SettingsPatch } from "@/lib/shared/settings-keys";

/** The optimistic next state plus the exact patch to send for it. */
export interface SettingsWrite {
  /** Optimistic next state, published to the store before the request. */
  next: PiWorkConfig;
  /** Patch to PUT; only keys in {@link SETTINGS_OWNED_KEYS} are honored. */
  patch: SettingsPatch;
}

/**
 * The single write entry for `~/.pi-work/config.yaml` settings.
 *
 * Two modalities share one implementation — the optimistic store update, the
 * rollback and the success/error feedback:
 *
 * - {@link useSettingsWrite.apply} — an immediate setting: the caller computes
 *   the next config and the patch is derived from the top-level keys that
 *   actually changed. Only those keys are sent.
 * - {@link useSettingsWrite.submit} — a staged form: the caller supplies the
 *   explicit patch (it may carry server-only fields such as
 *   `web_access.tavily.clear_api_key`) plus the optimistic next state.
 *
 * Sections never `fetch("/api/settings")` themselves; bypasses lose optimistic
 * update and rollback and must not grow back.
 */
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

  /** Immediate setting: derive the patch from the changed top-level keys. */
  const apply = useCallback(
    (computeNext: (prev: PiWorkConfig) => PiWorkConfig): Promise<boolean> => {
      const prev = configRef.current;
      if (!prev) return Promise.resolve(false);
      const next = computeNext(prev);
      return runWrite({ next, patch: diffPatch(prev, next) });
    },
    [runWrite],
  );

  /** Staged form: the caller supplies the patch for one or more keys. */
  const submit = useCallback(
    (
      patch: SettingsPatch,
      computeNext: (prev: PiWorkConfig) => PiWorkConfig = (prev) => prev,
    ): Promise<boolean> => {
      const prev = configRef.current;
      if (!prev) return Promise.resolve(false);
      return runWrite({ next: computeNext(prev), patch });
    },
    [runWrite],
  );

  return { apply, submit };
}

/** Top-level keys in {@link SETTINGS_OWNED_KEYS} whose content changed. */
export function diffPatch(prev: PiWorkConfig, next: PiWorkConfig): SettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const key of SETTINGS_OWNED_KEYS) {
    if (!isContentEqual(prev[key], next[key])) patch[key] = next[key];
  }
  return patch as SettingsPatch;
}

export type SettingsApply = ReturnType<typeof useSettingsWrite>["apply"];
export type SettingsSubmit = ReturnType<typeof useSettingsWrite>["submit"];