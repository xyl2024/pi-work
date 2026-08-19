"use client";

import { useCallback, useEffect, useRef } from "react";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/hooks/useI18n";
import { setSettings } from "@/hooks/settingsStore";
import type { PiWorkConfig } from "@/lib/config";

/**
 * Shared "immediate-apply" handler for the settings modal sections
 * (Right-side buttons, Custom Tools, File preview limits, Typewriter
 * effect, APPEND_SYSTEM.md loader, etc.). Each section owns a small
 * piece of `PiWorkConfig`; when the user toggles something we
 *
 *   1. optimistically setConfig + setOriginalConfig (keeps
 *      `isDirty === false` so closing the modal does not prompt
 *      "discard changes?")
 *   2. publish the new config to the global settings store so
 *      AppShell / chat input pick it up on the next render
 *   3. PUT the whole PiWorkConfig to /api/settings
 *   4. on failure, roll back to the previous config and toast an error
 *
 * The previous config is tracked in a ref synced via useEffect — a
 * stale closure would otherwise rollback against a value that's no
 * longer in state. The pattern unifies ~8 near-identical handlers
 * that used to live in SettingsModal.tsx.
 */
export function useImmediateApply({
  config,
  setConfig,
  setOriginalConfig,
}: {
  config: PiWorkConfig | null;
  setConfig: (next: PiWorkConfig | null) => void;
  setOriginalConfig: (next: PiWorkConfig | null) => void;
}) {
  const configRef = useRef<PiWorkConfig | null>(config);
  useEffect(() => { configRef.current = config; }, [config]);

  const toast = useToast();
  const { t } = useI18n();

  return useCallback(
    async (computeNext: (prev: PiWorkConfig) => PiWorkConfig): Promise<boolean> => {
      const prev = configRef.current;
      if (!prev) return false;
      const next = computeNext(prev);
      setConfig(next);
      setOriginalConfig(next);
      setSettings(next);
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        toast.show({ kind: "success", message: t("Settings saved") });
        return true;
      } catch (e) {
        // Roll back the optimistic local update so the row reflects
        // the actual on-disk value (not the rejected write).
        setConfig(prev);
        setOriginalConfig(prev);
        setSettings(prev);
        toast.show({
          kind: "error",
          message: e instanceof Error && e.message ? e.message : t("Failed to save settings"),
        });
        return false;
      }
    },
    [setConfig, setOriginalConfig, toast, t],
  );
}