"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/ui/Toast";
import { SettingsSection } from "../SettingsSection";
import { SecretTextInput } from "../models-config/form-fields";
import type { PiWorkConfig } from "@/lib/shared/config-types";

export function WebAccessSection({ config, apply }: { config: PiWorkConfig; apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean> }) {
  const { t } = useI18n();
  const toast = useToast();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasKey, setHasKey] = useState(Boolean(config.web_access.tavily.api_key));

  useEffect(() => {
    setHasKey(Boolean(config.web_access.tavily.api_key) || config.web_access.tavily.has_api_key === true);
  }, [config.web_access]);

  const saveKey = () => {
    if (!key.trim()) return;
    setSaving(true);
    void fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ web_access: { tavily: { api_key: key.trim() } } }) })
      .then(async (response) => { if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${response.status}`); setKey(""); setHasKey(true); toast.show({ kind: "success", message: t("Settings saved") }); })
      .catch((error) => toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }))
      .finally(() => setSaving(false));
  };

  const clearKey = () => {
    setSaving(true);
    void fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ web_access: { tavily: { clear_api_key: true } } }) })
      .then(async (response) => { if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${response.status}`); setKey(""); setHasKey(false); toast.show({ kind: "success", message: t("Settings saved") }); })
      .catch((error) => toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }))
      .finally(() => setSaving(false));
  };

  return (
    <SettingsSection id="web-access" topGap>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>{t("Web Access")}</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
        {t("Enable web search and webpage fetching for new Agent sessions. Tavily API Key is stored in ~/.pi-work/config.yaml.")}
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text)", marginBottom: 14 }}>
        <input type="checkbox" checked={config.web_access.enabled} onChange={() => void apply((prev) => ({ ...prev, web_access: { ...prev.web_access, enabled: !prev.web_access.enabled } }))} />
        {t("Web Access enabled")}
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <SecretTextInput value={key} onChange={setKey} placeholder={hasKey ? t("API Key configured; enter a new key to replace") : "tvly-..."} mono />
        <button type="button" onClick={saveKey} disabled={!key.trim() || saving} style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>{t("Save")}</button>
        <button type="button" onClick={clearKey} disabled={!hasKey || saving} style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>{t("Clear")}</button>
      </div>
      <div style={{ fontSize: 11, color: hasKey ? "var(--text-muted)" : "var(--text-dim)", marginTop: 8 }}>
        {hasKey ? t("Tavily API Key configured") : t("Tavily API Key not configured")}
      </div>
    </SettingsSection>
  );
}
