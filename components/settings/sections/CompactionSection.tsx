"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { useToast } from "@/components/ui/Toast";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { NumericField } from "@/components/ui/NumericField";
import { SecondaryButton } from "../controls";
import { SettingsGroup, SettingsNote, SettingsRow } from "../rows";
import {
  COMPACTION_LIMITS,
  DEFAULT_AGENT_COMPACTION,
  type CompactionConfig,
} from "@/lib/shared/agent-settings-types";
import type { SettingsPageDataCache } from "@/lib/client/settings-page-cache";
import { useSettingsPageData } from "../use-page-data";

async function loadCompactionConfig(): Promise<CompactionConfig> {
  const response = await fetch("/api/agent-settings/compaction");
  const data = (await response.json().catch(() => ({}))) as CompactionConfig & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export function CompactionSection({ pageCache }: { pageCache: SettingsPageDataCache }) {
  const { t } = useI18n();
  const toast = useToast();
  const {
    data: compactionConfig,
    loading,
    mutate,
  } = useSettingsPageData(pageCache, "compaction", loadCompactionConfig);
  const [resetting, setResetting] = useState(false);
  const [resetOk, flashResetOk] = useTransientFlag();

  const push = useCallback(async (
    next: Partial<CompactionConfig>,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!compactionConfig) return { ok: false, error: t("Compaction config not loaded") };
    const merged: CompactionConfig = { ...compactionConfig, ...next };
    try {
      const res = await fetch("/api/agent-settings/compaction", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      }
      mutate(merged);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [compactionConfig, t, mutate]);

  const commit = useCallback(async (next: Partial<CompactionConfig>) => {
    const result = await push(next);
    if (!result.ok) {
      toast.show({ kind: "error", message: result.error ?? t("Failed to save compaction config") });
    }
  }, [push, t, toast]);

  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      const res = await fetch("/api/agent-settings/compaction", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      mutate(DEFAULT_AGENT_COMPACTION);
      flashResetOk();
      toast.show({ kind: "success", message: t("Reset compaction config") });
    } catch (e) {
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to save compaction config"),
      });
    } finally {
      setResetting(false);
    }
  }, [t, toast, flashResetOk, mutate]);

  if (loading) return <SettingsNote>{t("Loading...")}</SettingsNote>;
  if (!compactionConfig) return <SettingsNote tone="error">{t("Failed to load settings")}</SettingsNote>;

  return (
    <SettingsGroup
      action={(
        <SecondaryButton
          onClick={() => void handleReset()}
          disabled={resetting || resetOk}
          style={resetOk ? { color: "var(--success)" } : undefined}
        >
          {resetOk ? t("Saved") : t("Reset to defaults")}
        </SecondaryButton>
      )}
    >
      <SettingsRow
        title={t("Auto compaction")}
        description={t("Compacts when the context exceeds the model window minus the reserve.")}
      >
        <ToggleSwitch
          on={compactionConfig.enabled}
          onChange={(next) => void commit({ enabled: next })}
          label={t("Auto compaction")}
        />
      </SettingsRow>

      <SettingsRow
        title={t("Reserve tokens")}
        description={t("Range: {min}–{max}", {
          min: COMPACTION_LIMITS.reserveTokens.min,
          max: COMPACTION_LIMITS.reserveTokens.max,
        })}
      >
        <NumericField
          value={compactionConfig.reserveTokens}
          onCommit={(next) => { if (next !== null) void commit({ reserveTokens: next }); }}
          min={COMPACTION_LIMITS.reserveTokens.min}
          max={COMPACTION_LIMITS.reserveTokens.max}
          placeholder={String(DEFAULT_AGENT_COMPACTION.reserveTokens)}
          ariaLabel={t("Reserve tokens")}
        />
      </SettingsRow>

      <SettingsRow
        title={t("Keep recent tokens")}
        description={t("Range: {min}–{max}", {
          min: COMPACTION_LIMITS.keepRecentTokens.min,
          max: COMPACTION_LIMITS.keepRecentTokens.max,
        })}
      >
        <NumericField
          value={compactionConfig.keepRecentTokens}
          onCommit={(next) => { if (next !== null) void commit({ keepRecentTokens: next }); }}
          min={COMPACTION_LIMITS.keepRecentTokens.min}
          max={COMPACTION_LIMITS.keepRecentTokens.max}
          placeholder={String(DEFAULT_AGENT_COMPACTION.keepRecentTokens)}
          ariaLabel={t("Keep recent tokens")}
        />
      </SettingsRow>

      <SettingsNote>
        {t("Applies to new sessions only — active sessions keep their current settings.")}
      </SettingsNote>
    </SettingsGroup>
  );
}
