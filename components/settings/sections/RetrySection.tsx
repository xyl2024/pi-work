"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { RetryNumberRow } from "../rows";
import {
  DEFAULT_AGENT_RETRY,
  RETRY_LIMITS,
  formatBackoffPreview,
  type AgentRetryConfig,
} from "@/lib/shared/agent-settings-types";

/**
 * Section 11: Agent retry (~/.pi/agent/settings.json).
 *
 * Independent state machine — the retry config lives in the pi SDK's
 * settings.json, NOT in ~/.pi-work/config.yaml. Reads/writes go
 * through /api/agent-settings/retry, and the SDK picks up the change
 * only at session start (so the section's help text reminds the user
 * "applies to new sessions only").
 *
 * Each RetryNumberRow owns its own draft + range validation; on
 * commit we PUT through `pushRetry` which preserves any unset
 * provider fields so a partial update doesn't blank the rest.
 */
export function RetrySection() {
  const { t } = useI18n();
  const toast = useToast();
  const [retryConfig, setRetryConfig] = useState<AgentRetryConfig | null>(null);
  const [retryLoading, setRetryLoading] = useState(true);
  const [retryResetting, setRetryResetting] = useState(false);
  const [retryResetOk, setRetryResetOk] = useState(false);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent-settings/retry")
      .then((r) => r.json())
      .then((d: AgentRetryConfig & { error?: string }) => {
        if (cancelled) return;
        if (d && typeof d === "object" && !d.error) {
          setRetryConfig(d);
        }
      })
      .catch(() => { /* leave null: section shows a "not loaded" hint */ })
      .finally(() => { if (!cancelled) setRetryLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Each RetryNumberRow commits (or rolls back) against `retryConfig`,
  // and the server-side PUT handler enforces the same range rules.
  // On success we trust the server's response and update local state;
  // on failure we keep the previous `retryConfig` so the row's draft
  // rolls back to the last accepted value via its own useEffect.
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
        // Preserve unset keys from the previous value. `next.provider`
        // is allowed to be a partial (e.g. only `maxRetries`) so the
        // row's "null means unset" commit flows through cleanly.
        timeoutMs: next.provider?.timeoutMs ?? retryConfig.provider.timeoutMs,
        maxRetries: next.provider?.maxRetries ?? retryConfig.provider.maxRetries,
        maxRetryDelayMs: next.provider?.maxRetryDelayMs ?? retryConfig.provider.maxRetryDelayMs,
      },
    };
    // Drop provider fields that are undefined so the server knows to
    // omit them from settings.json (= SDK default).
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
      setRetryConfig(merged);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [retryConfig, t]);

  const handleRetryEnabledChange = useCallback(async (next: boolean) => {
    const result = await pushRetry({ enabled: next });
    if (!result.ok) {
      toast.show({ kind: "error", message: result.error ?? t("Failed to save retry config") });
    } else {
      toast.show({ kind: "success", message: t("Saved") });
    }
  }, [pushRetry, t, toast]);

  const handleRetryMaxRetriesChange = useCallback(async (next: number | null) => {
    if (next === null) return; // required field; RetryNumberRow's validation prevents this
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
      // Reset means "drop the override" — server removes the retry
      // key entirely. Locally we re-fetch defaults so every row's
      // draft snaps to its placeholder.
      setRetryConfig(DEFAULT_AGENT_RETRY);
      setRetryResetOk(true);
      setTimeout(() => setRetryResetOk(false), 1500);
      toast.show({ kind: "success", message: t("Reset retry config") });
    } catch (e) {
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to save retry config"),
      });
    } finally {
      setRetryResetting(false);
    }
  }, [t, toast]);

  return (
    <div data-settings-section="settings-section-retry" style={{ marginBottom: 24, marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>{t("Agent retry")}</h3>
        <button
          onClick={() => void handleRetryReset()}
          disabled={retryResetting || retryResetOk || !retryConfig}
          style={{
            padding: "4px 12px", height: 28,
            background: retryResetOk ? "#16a34a" : retryResetting ? "var(--bg-panel)" : "transparent",
            border: `1px solid ${retryResetOk ? "#16a34a" : "var(--border)"}`,
            borderRadius: 6,
            color: retryResetOk ? "#fff" : retryResetting ? "var(--text-muted)" : "var(--text-muted)",
            cursor: retryResetting || !retryConfig ? "default" : "pointer",
            fontSize: 12, fontWeight: 500,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease",
            opacity: retryResetting || !retryConfig ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (retryResetting || retryResetOk) return;
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.color = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = retryResetOk ? "#16a34a" : "var(--border)";
            e.currentTarget.style.color = retryResetOk ? "#fff" : "var(--text-muted)";
          }}
        >
          {retryResetOk && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          <span>{retryResetOk ? t("Saved") : t("Reset to defaults")}</span>
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.5 }}>
        {t("Auto-retry on transient LLM errors (overloaded, rate limit, 5xx, stream breaks). Takes effect on new sessions only.")}
      </p>

      {retryLoading ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("Loading...")}</div>
      ) : !retryConfig ? (
        <div style={{ fontSize: 12, color: "#ef4444" }}>{t("Failed to load settings")}</div>
      ) : (
        <>
          {/* Master toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={retryConfig.enabled}
              onChange={(e) => void handleRetryEnabledChange(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <span style={{ fontSize: 13, color: "var(--text)" }}>{t("Enable retry")}</span>
          </label>

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

          {/* Backoff preview — derives from current input values, not SDK defaults */}
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 18 }}>
            {(() => {
              const { shown, total } = formatBackoffPreview(retryConfig.baseDelayMs, retryConfig.maxRetries);
              if (total === 0) return t("Backoff sequence preview") + ": " + t("no retries");
              const parts = shown.map((s) => `${s}s`);
              if (total > shown.length) parts.push("…");
              return t("Backoff sequence preview") + ": " + parts.join(", ") + ` (${t("exponential, max {max} retries", { max: total })})`;
            })()}
          </div>

          {/* Provider-level (advanced) */}
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
    </div>
  );
}