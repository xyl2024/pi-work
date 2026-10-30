"use client";

import { useState, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { useToast } from "@/components/ui/Toast";
import { RetryNumberRow } from "../rows";
import { SecondaryButton } from "../controls";
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

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 4 }}>
        <SecondaryButton
          onClick={() => void handleRetryReset()}
          disabled={retryResetting || retryResetOk || !retryConfig}
          style={retryResetOk ? { borderColor: "var(--success)", color: "var(--success)" } : undefined}
        >
          {retryResetOk && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          <span>{retryResetOk ? t("Saved") : t("Reset to defaults")}</span>
        </SecondaryButton>
      </div>
      {retryLoading ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("Loading...")}</div>
      ) : !retryConfig ? (
        <div style={{ fontSize: 12, color: "var(--error)" }}>{t("Failed to load settings")}</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: "var(--text)" }}>{t("Enable retry")}</span>
            <ToggleSwitch
              on={retryConfig.enabled}
              onChange={(next) => void handleRetryEnabledChange(next)}
              label={t("Enable retry")}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 12 }}>
            <RetryNumberRow
              label={t("Max retries")}
              min={RETRY_LIMITS.maxRetries.min}
              max={RETRY_LIMITS.maxRetries.max}
              value={retryConfig.maxRetries}
              placeholder={String(DEFAULT_AGENT_RETRY.maxRetries)}
              optional={false}
              onCommit={handleRetryMaxRetriesChange}
            />
            <RetryNumberRow
              label={t("Base delay (ms)")}
              min={RETRY_LIMITS.baseDelayMs.min}
              max={RETRY_LIMITS.baseDelayMs.max}
              value={retryConfig.baseDelayMs}
              placeholder={String(DEFAULT_AGENT_RETRY.baseDelayMs)}
              optional={false}
              unitSuffix="ms"
              onCommit={handleRetryBaseDelayChange}
            />
          </div>

          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 18 }}>
            {(() => {
              const { shown, total } = formatBackoffPreview(retryConfig.baseDelayMs, retryConfig.maxRetries);
              if (total === 0) return t("Backoff sequence preview") + ": " + t("no retries");
              const parts = shown.map((s) => `${s}s`);
              if (total > shown.length) parts.push("…");
              return t("Backoff sequence preview") + ": " + parts.join(", ") + ` (${t("exponential, max {max} retries", { max: total })})`;
            })()}
          </div>

          <h4 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", margin: "0 0 10px 0", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {t("Provider retry settings (advanced)")}
          </h4>

          <RetryNumberRow
            label={t("HTTP request timeout (ms)")}
            min={RETRY_LIMITS.provider.timeoutMs.min}
            max={RETRY_LIMITS.provider.timeoutMs.max}
            value={retryConfig.provider.timeoutMs ?? null}
            placeholder={t("SDK default")}
            optional={true}
            unitSuffix="ms"
            onCommit={(n) => handleRetryProviderFieldChange("timeoutMs", n)}
          />
          <RetryNumberRow
            label={t("Provider retries")}
            min={RETRY_LIMITS.provider.maxRetries.min}
            max={RETRY_LIMITS.provider.maxRetries.max}
            value={retryConfig.provider.maxRetries ?? null}
            placeholder={String(DEFAULT_AGENT_RETRY.provider.maxRetries)}
            optional={true}
            onCommit={(n) => handleRetryProviderFieldChange("maxRetries", n)}
          />
          <RetryNumberRow
            label={t("Max server-requested delay (ms)")}
            min={RETRY_LIMITS.provider.maxRetryDelayMs.min}
            max={RETRY_LIMITS.provider.maxRetryDelayMs.max}
            value={retryConfig.provider.maxRetryDelayMs ?? null}
            placeholder={String(DEFAULT_AGENT_RETRY.provider.maxRetryDelayMs)}
            optional={true}
            unitSuffix="ms"
            onCommit={(n) => handleRetryProviderFieldChange("maxRetryDelayMs", n)}
          />

          <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "10px 0 0 0", lineHeight: 1.4 }}>
            ⚠ {t("Applies to new sessions only — active sessions keep their current settings.")}
          </p>
        </>
      )}
    </>
  );
}