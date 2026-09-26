"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { SettingsSection } from "../SettingsSection";
import {
  Check,
  DangerButton,
  SecretTextInput,
} from "../controls";
import { SaveButton, UnsavedHint } from "../staged-save";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import type { SettingsApply, SettingsSubmit } from "../use-settings-write";
import type { DirtyReporter } from "../use-unsaved-changes";

export function WebAccessSection({
  config,
  apply,
  submit,
  onDirtyChange,
}: {
  config: PiWorkConfig;
  apply: SettingsApply;
  submit: SettingsSubmit;
  onDirtyChange?: DirtyReporter;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveOk, flashSaveOk] = useTransientFlag();
  const [hasKey, setHasKey] = useState(Boolean(config.web_access.tavily.api_key));

  useEffect(() => {
    setHasKey(Boolean(config.web_access.tavily.api_key) || config.web_access.tavily.has_api_key === true);
  }, [config.web_access]);

  const keyDirty = key.trim().length > 0;
  useEffect(() => {
    onDirtyChange?.("web-access", keyDirty);
  }, [keyDirty, onDirtyChange]);

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
          flashSaveOk();
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
      <div style={{ marginBottom: 14 }}>
        <Check
          label={t("Web Access enabled")}
          checked={config.web_access.enabled}
          onChange={() => void apply((prev) => ({ ...prev, web_access: { ...prev.web_access, enabled: !prev.web_access.enabled } }))}
        />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <SecretTextInput value={key} onChange={setKey} placeholder={hasKey ? t("API Key configured; enter a new key to replace") : "tvly-..."} mono />
        <UnsavedHint show={keyDirty} />
        <SaveButton canSave={keyDirty} saving={saving} saved={saveOk} onClick={saveKey} />
        <DangerButton onClick={clearKey} disabled={!hasKey || saving}>{t("Clear")}</DangerButton>
      </div>
      <div style={{ fontSize: 11, color: hasKey ? "var(--text-muted)" : "var(--text-dim)", marginTop: 8 }}>
        {hasKey ? t("Tavily API Key configured") : t("Tavily API Key not configured")}
      </div>
    </SettingsSection>
  );
}