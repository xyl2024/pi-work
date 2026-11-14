"use client";

import { useState, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { useToast } from "@/components/ui/Toast";
import { SecondaryButton } from "../controls";
import { SettingsGroup, SettingsNote, SettingsRow } from "../rows";
import { NumericField } from "@/components/ui/NumericField";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import {
  DEFAULT_AGENT_RETRY,
  RETRY_LIMITS,
  formatBackoffPreview,
  type AgentRetryConfig,
} from "@/lib/shared/agent-settings-types";
import type { SettingsPageDataCache } from "@/lib/client/settings-page-cache";
import { useSettingsPageData } from "../use-page-data";

async function loadRetryConfig(): Promise<AgentRetryConfig> {
  const response = await fetch("/api/agent-settings/retry");
  const data = (await response.json().catch(() => ({}))) as AgentRetryConfig & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export function RetrySection({ pageCache }: { pageCache: SettingsPageDataCache }) {
  const { t } = useI18n();
  const toast = useToast();
  const {
    data: retryConfig,
    loading: retryLoading,
    mutate: mutateRetryConfig,
  } = useSettingsPageData(pageCache, "retry", loadRetryConfig);
  const [retryResetting, setRetryResetting] = useState(false);
  const [retryResetOk, flashRetryResetOk] = useTransientFlag();

  const pushRetry = useCallback(async (
    next: Partial<AgentRetryConfig>,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!retryConfig) return { ok: false, error: t("Retry config not loaded") };
    const merged: AgentRetryConfig = {
      enabled: next.enabled ?? retryConfig.enabled,
      maxRetries: next.maxRetries ?? retryConfig.maxRetries,
      baseDelayMs: next.baseDelayMs ?? retryConfig.baseDelayMs,
      provider: {
        ...(next.provider ?? {}),
        timeoutMs: next.provider?.timeoutMs ?? retryConfig.provider.timeoutMs,
        maxRetries: next.provider?.maxRetries ?? retryConfig.provider.maxRetries,
        maxRetryDelayMs: next.provider?.maxRetryDelayMs ?? retryConfig.provider.maxRetryDelayMs,
      },
    };
    const payload: Record<string, unknown> = {
      enabled: merged.enabled,
      maxRetries: merged.maxRetries,
      baseDelayMs: merged.baseDelayMs,
      provider: {
        ...(merged.provider.timeoutMs !== undefined ? { timeoutMs: merged.provider.timeoutMs } : {}),
        ...(merged.provider.maxRetries !== undefined ? { maxRetries: merged.provider.maxRetries } : {}),
        ...(merged.provider.maxRetryDelayMs !== undefined ? { maxRetryDelayMs: merged.provider.maxRetryDelayMs } : {}),
      },
    };
    try {
      const res = await fetch("/api/agent-settings/retry", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      }
      mutateRetryConfig(merged);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [retryConfig, t, mutateRetryConfig]);

  const handleRetryEnabledChange = useCallback(async (next: boolean) => {
    const result = await pushRetry({ enabled: next });
    if (!result.ok) {
      toast.show({ kind: "error", message: result.error ?? t("Failed to save retry config") });
    } else {
      toast.show({ kind: "success", message: t("Saved") });
    }
  }, [pushRetry, t, toast]);

  const handleRetryMaxRetriesChange = useCallback(async (next: number | null) => {
    if (next === null) return;
    const result = await pushRetry({ maxRetries: next });
    if (!result.ok) toast.show({ kind: "error", message: result.error ?? t("Failed to save retry config") });
  }, [pushRetry, t, toast]);

  const handleRetryBaseDelayChange = useCallback(async (next: number | null) => {
    if (next === null) return;
    const result = await pushRetry({ baseDelayMs: next });
    if (!result.ok) toast.show({ kind: "error", message: result.error ?? t("Failed to save retry config") });
  }, [pushRetry, t, toast]);

  const handleRetryProviderFieldChange = useCallback(async (
    field: "timeoutMs" | "maxRetries" | "maxRetryDelayMs",
    next: number | null,
  ) => {
    const provider = { [field]: next === null ? undefined : next } as Partial<AgentRetryConfig["provider"]>;
    const result = await pushRetry({ provider });
    if (!result.ok) toast.show({ kind: "error", message: result.error ?? t("Failed to save retry config") });
  }, [pushRetry, t, toast]);

  const handleRetryReset = useCallback(async () => {
    setRetryResetting(true);
    try {
      const res = await fetch("/api/agent-settings/retry", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      mutateRetryConfig(DEFAULT_AGENT_RETRY);
      flashRetryResetOk();
      toast.show({ kind: "success", message: t("Reset retry config") });
    } catch (e) {
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to save retry config"),
      });
    } finally {
      setRetryResetting(false);
    }
  }, [t, toast, flashRetryResetOk, mutateRetryConfig]);

  if (retryLoading) return <SettingsNote>{t("Loading...")}</SettingsNote>;
  if (!retryConfig) return <SettingsNote tone="error">{t("Failed to load settings")}</SettingsNote>;

  const backoff = formatBackoffPreview(retryConfig.baseDelayMs, retryConfig.maxRetries);
  const backoffText = backoff.total === 0
    ? t("no retries")
    : `${backoff.shown.map((seconds) => `${seconds}s`).join(", ")}${backoff.total > backoff.shown.length ? ", …" : ""}`;

  return (
    <>
      <SettingsGroup
        action={(
          <SecondaryButton
            onClick={() => void handleRetryReset()}
            disabled={retryResetting || retryResetOk}
            style={retryResetOk ? { color: "var(--success)" } : undefined}
          >
            {retryResetOk ? t("Saved") : t("Reset to defaults")}
          </SecondaryButton>
        )}
      >
        <SettingsRow
          title={t("Enable retry")}
          description={t("Retry failed agent runs with exponential backoff.")}
        >
          <ToggleSwitch
            on={retryConfig.enabled}
            onChange={(next) => void handleRetryEnabledChange(next)}
            label={t("Enable retry")}
          />
        </SettingsRow>

        <SettingsRow
          title={t("Max retries")}
          description={t("Range: {min}–{max}", {
            min: RETRY_LIMITS.maxRetries.min,
            max: RETRY_LIMITS.maxRetries.max,
          })}
        >
          <NumericField
            value={retryConfig.maxRetries}
            onCommit={handleRetryMaxRetriesChange}
            min={RETRY_LIMITS.maxRetries.min}
            max={RETRY_LIMITS.maxRetries.max}
            placeholder={String(DEFAULT_AGENT_RETRY.maxRetries)}
            ariaLabel={t("Max retries")}
          />
        </SettingsRow>

        <SettingsRow
          title={t("Base delay")}
          description={t("Backoff sequence: {sequence}", { sequence: backoffText })}
        >
          <NumericField
            value={retryConfig.baseDelayMs}
            onCommit={handleRetryBaseDelayChange}
            min={RETRY_LIMITS.baseDelayMs.min}
            max={RETRY_LIMITS.baseDelayMs.max}
            placeholder={String(DEFAULT_AGENT_RETRY.baseDelayMs)}
            unit="ms"
            ariaLabel={t("Base delay (ms)")}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("Provider retry settings (advanced)")}>
        <SettingsRow
          title={t("HTTP request timeout")}
          description={t("Range: {min}–{max} (empty = SDK default)", {
            min: RETRY_LIMITS.provider.timeoutMs.min,
            max: RETRY_LIMITS.provider.timeoutMs.max,
          })}
        >
          <NumericField
            value={retryConfig.provider.timeoutMs ?? null}
            onCommit={(n) => handleRetryProviderFieldChange("timeoutMs", n)}
            min={RETRY_LIMITS.provider.timeoutMs.min}
            max={RETRY_LIMITS.provider.timeoutMs.max}
            placeholder={t("SDK default")}
            optional
            unit="ms"
            ariaLabel={t("HTTP request timeout (ms)")}
          />
        </SettingsRow>
        <SettingsRow
          title={t("Provider retries")}
          description={t("Range: {min}–{max}", {
            min: RETRY_LIMITS.provider.maxRetries.min,
            max: RETRY_LIMITS.provider.maxRetries.max,
          })}
        >
          <NumericField
            value={retryConfig.provider.maxRetries ?? null}
            onCommit={(n) => handleRetryProviderFieldChange("maxRetries", n)}
            min={RETRY_LIMITS.provider.maxRetries.min}
            max={RETRY_LIMITS.provider.maxRetries.max}
            placeholder={String(DEFAULT_AGENT_RETRY.provider.maxRetries)}
            optional
            ariaLabel={t("Provider retries")}
          />
        </SettingsRow>
        <SettingsRow
          title={t("Max server-requested delay")}
          description={t("Range: {min}–{max} (empty = SDK default)", {
            min: RETRY_LIMITS.provider.maxRetryDelayMs.min,
            max: RETRY_LIMITS.provider.maxRetryDelayMs.max,
          })}
        >
          <NumericField
            value={retryConfig.provider.maxRetryDelayMs ?? null}
            onCommit={(n) => handleRetryProviderFieldChange("maxRetryDelayMs", n)}
            min={RETRY_LIMITS.provider.maxRetryDelayMs.min}
            max={RETRY_LIMITS.provider.maxRetryDelayMs.max}
            placeholder={String(DEFAULT_AGENT_RETRY.provider.maxRetryDelayMs)}
            optional
            unit="ms"
            ariaLabel={t("Max server-requested delay (ms)")}
          />
        </SettingsRow>

        <SettingsNote>
          {t("Applies to new sessions only — active sessions keep their current settings.")}
        </SettingsNote>
      </SettingsGroup>
    </>
  );
}
