"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../../ui/Toast";
import { SectionTitle, SecretTextInput, Field } from "./form-fields";
import type { ApiKeyProvider } from "./types";
import styles from "./ApiKeyDetail.module.css";

export function ApiKeyDetail({ provider, onRefresh }: { provider: ApiKeyProvider; onRefresh: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    setApiKey("");
    setError(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
        toast.show({ kind: "error", message: d.error ?? `HTTP ${res.status}` });
      } else {
        setApiKey("");
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
        toast.show({ kind: "success", message: t("API key saved") });
      }
    } catch (e) {
      setError(String(e));
      toast.show({ kind: "error", message: String(e) });
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh, t, toast]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
        toast.show({ kind: "error", message: d.error ?? `HTTP ${res.status}` });
      } else {
        onRefresh();
        toast.show({ kind: "success", message: t("API key removed") });
      }
    } catch (e) {
      setError(String(e));
      toast.show({ kind: "error", message: String(e) });
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh, t, toast]);

  const ready = !saving && apiKey.trim() !== "" && !savedOk;

  return (
    <div className={styles.detail}>
      <div className={styles.header}>
        <SectionTitle>{t("API Key")}</SectionTitle>
        <div className={styles.status} data-configured={provider.configured ? "true" : undefined}>
          <span className={styles.statusDot} />
          <span className={styles.statusText}>
            {provider.configured ? t("configured") : t("not configured")}
          </span>
        </div>
      </div>

      <p className={styles.description}>
        {provider.configured
          ? t("API key stored message")
          : t("Enter your {name} API key to enable {n} models.", { name: provider.displayName, n: provider.modelCount })}
      </p>

      <Field label={t("API Key")}>
        <div className={styles.fieldRow}>
          <div className={styles.keyField}>
            <SecretTextInput
              value={apiKey}
              onChange={setApiKey}
              onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleSave(); }}
              placeholder={provider.configured ? t("Enter new key to replace...") : "sk-..."}
              autoComplete="new-password"
              spellCheck={false}
              mono
            />
          </div>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSave}
            disabled={!ready}
            data-ready={ready ? "true" : undefined}
            data-saved={savedOk ? "true" : undefined}
          >
            {savedOk && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {savedOk ? t("Saved") : saving ? t("Saving...") : t("Save")}
          </button>
        </div>
      </Field>

      {error && <p className={styles.error}>{error}</p>}

      {provider.configured && (
        <button type="button" className={styles.disconnect} onClick={handleRemove} disabled={removing}>
          {removing ? t("Removing...") : t("Disconnect")}
        </button>
      )}
    </div>
  );
}
