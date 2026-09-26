"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SettingsSection } from "../SettingsSection";
import { SecretTextInput } from "../models-config/form-fields";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import type { SettingsApply, SettingsSubmit } from "../use-settings-write";

export function WebAccessSection({
  config,
  apply,
  submit,
}: {
  config: PiWorkConfig;
  apply: SettingsApply;
  submit: SettingsSubmit;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasKey, setHasKey] = useState(Boolean(config.web_access.tavily.api_key));

  useEffect(() => {
    setHasKey(Boolean(config.web_access.tavily.api_key) || config.web_access.tavily.has_api_key === true);
  }, [config.web_access]);

  // The Tavily key is a staged secret: it goes through the same write entry as
  // every other setting (optimistic update + rollback + one success toast),
  // with the server-only `clear_api_key` flag carried explicitly.
  const saveKey = () => {
    if (!key.trim()) return;
    setSaving(true);
    void submit(
      { web_access: { tavily: { api_key: key.trim() } } },
      (prev) => ({
        ...prev,
        web_access: { enabled: prev.web_access.enabled, tavily: { has_api_key: true } },
      }),
    )
      .then((ok) => {
        if (ok) {
          setKey("");
          setHasKey(true);
        }
      })
      .finally(() => setSaving(false));
  };

  const clearKey = () => {
    setSaving(true);
    void submit(
      { web_access: { tavily: { clear_api_key: true } } },
      (prev) => ({
        ...prev,
        web_access: { enabled: prev.web_access.enabled, tavily: {} },
      }),
    )
      .then((ok) => {
        if (ok) {
          setKey("");
          setHasKey(false);
        }
      })
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