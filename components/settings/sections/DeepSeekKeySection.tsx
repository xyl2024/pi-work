"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { useToast } from "@/components/ui/Toast";
import type { DeepSeekApiKeyStatus } from "@/lib/shared/deepseek";
import { SaveButton, UnsavedHint } from "../staged-save";
import { DangerButton, SecretTextInput } from "../controls";
import type { DirtyReporter } from "../use-unsaved-changes";

const ENDPOINT = "/api/settings/deepseek-key";

export function DeepSeekKeySection({ onDirtyChange }: { onDirtyChange?: DirtyReporter }) {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<DeepSeekApiKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [saveOk, flashSaveOk] = useTransientFlag();

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus((await response.json()) as DeepSeekApiKeyStatus);
    } catch {
      toast.show({ kind: "error", message: t("Failed to load API key status") });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const keyDirty = key.trim().length > 0;

  useEffect(() => {
    onDirtyChange?.("deepseek-key", keyDirty);
  }, [keyDirty, onDirtyChange]);

  const saveKey = async () => {
    if (!keyDirty) return;
    setSaving(true);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key.trim() }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setKey("");
      flashSaveOk();
      await loadStatus();
      toast.show({ kind: "success", message: t("API key saved") });
    } catch (error) {
      toast.show({
        kind: "error",
        message: error instanceof Error && error.message ? error.message : t("Failed to save API key"),
      });
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    setClearing(true);
    try {
      const response = await fetch(ENDPOINT, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setKey("");
      await loadStatus();
      toast.show({ kind: "success", message: t("API key removed") });
    } catch (error) {
      toast.show({
        kind: "error",
        message: error instanceof Error && error.message ? error.message : t("Failed to clear API key"),
      });
    } finally {
      setClearing(false);
    }
  };

  const statusLabel = !status?.configured
    ? t("DeepSeek API Key not configured")
    : status.source === "file"
      ? t("Saved in Pi Work — {masked}", { masked: status.masked ?? "" })
      : t("Using DEEPSEEK_API_KEY environment variable — {masked}", {
          masked: status.masked ?? "",
        });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 4 }}>
        <UnsavedHint show={keyDirty} />
        <SaveButton
          canSave={keyDirty && !saving && !clearing}
          saving={saving}
          saved={saveOk}
          onClick={saveKey}
        />
      </div>

      <div
        style={{
          fontSize: 12,
          color: status?.configured ? "var(--success)" : "var(--text-dim)",
          margin: "0 0 12px 0",
          lineHeight: 1.5,
        }}
      >
        {loading ? t("Loading...") : statusLabel}
      </div>

      <SecretTextInput
        value={key}
        onChange={setKey}
        mono
        placeholder={
          status?.configured
            ? t("API Key configured; enter a new key to replace")
            : t("Enter the DeepSeek API Key")
        }
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <DangerButton
          onClick={clearKey}
          disabled={status?.source !== "file" || saving || clearing}
        >
          {clearing ? t("Clearing...") : t("Clear")}
        </DangerButton>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10, lineHeight: 1.5 }}>
        {t("The key is stored in the Pi Work data directory with 0600 permissions and takes priority over the DEEPSEEK_API_KEY environment variable.")}
      </div>
    </>
  );
}
