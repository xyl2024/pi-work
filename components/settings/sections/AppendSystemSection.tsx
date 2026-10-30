"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { useToast } from "@/components/ui/Toast";
import { SaveButton, UnsavedHint } from "../staged-save";
import { TextArea } from "../controls";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import type { DirtyReporter } from "../use-unsaved-changes";
import type { AppendSystemFile, SettingsPageDataCache } from "@/lib/client/settings-page-cache";
import { useSettingsPageData } from "../use-page-data";

async function loadAppendSystem(): Promise<AppendSystemFile> {
  const response = await fetch("/api/append-system");
  const data = (await response.json().catch(() => ({}))) as
    & Partial<AppendSystemFile>
    & { error?: string };
  if (!response.ok || data.error || typeof data.content !== "string" || typeof data.path !== "string") {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return { content: data.content, path: data.path, exists: !!data.exists };
}

export function AppendSystemSection({
  config,
  apply,
  onDirtyChange,
  pageCache,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
  onDirtyChange?: DirtyReporter;
  pageCache: SettingsPageDataCache;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const {
    data: appendSystem,
    loading: appendSystemLoading,
    mutate: mutateAppendSystem,
  } = useSettingsPageData(pageCache, "append-system", loadAppendSystem);
  const [draft, setDraft] = useState<string | null>(null);
  const [appendSystemSaving, setAppendSystemSaving] = useState(false);
  const [appendSystemSavedOk, flashAppendSystemSavedOk] = useTransientFlag();

  const savedContent = appendSystem?.content ?? "";
  const content = draft ?? savedContent;

  const appendSystemDirty = appendSystem !== undefined && content !== savedContent;

  useEffect(() => {
    onDirtyChange?.("append-system", appendSystemDirty);
  }, [appendSystemDirty, onDirtyChange]);

  const handleAppendSystemSave = useCallback(async () => {
    if (!appendSystem) return;
    setAppendSystemSaving(true);
    try {
      const res = await fetch("/api/append-system", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      mutateAppendSystem({ ...appendSystem, content, exists: true });
      setDraft(null);
      flashAppendSystemSavedOk();
      toast.show({ kind: "success", message: t("Settings saved") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to save append system prompt") });
    } finally {
      setAppendSystemSaving(false);
    }
  }, [appendSystem, content, flashAppendSystemSavedOk, mutateAppendSystem, t, toast]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: 0 }}>
          {t("Append System Prompt")}
        </h4>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <UnsavedHint show={appendSystemDirty} />
          <SaveButton
            canSave={appendSystemDirty}
            saving={appendSystemSaving}
            saved={appendSystemSavedOk}
            onClick={handleAppendSystemSave}
          />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>
          {config.append_system.enabled ? t("Loading on") : t("Loading off")}
        </span>
        <ToggleSwitch
          on={config.append_system.enabled}
          onChange={(next) => {
            void apply((prev) => ({
              ...prev,
              append_system: { enabled: next },
            }));
          }}
          label={t("Loading on")}
        />
      </div>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)",
        padding: "4px 8px", marginBottom: 10,
        background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {appendSystem?.path ?? "~/.pi/agent/APPEND_SYSTEM.md"}
        {appendSystem && !appendSystem.exists && (
          <span style={{ marginLeft: 8, color: "var(--text-dim)" }}>({t("file does not exist yet — saving will create it")})</span>
        )}
      </div>
      <TextArea
        value={content}
        onChange={setDraft}
        disabled={appendSystemLoading || !appendSystem}
        placeholder={appendSystemLoading ? t("Loading...") : t("Markdown content appended after the built-in system prompt.")}
        mono
        style={{ height: 220 }}
      />
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: "0 0 10px" }}>
          {t("Pi documentation")}
        </h4>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text)" }}>
            {config.load_pi_docs ? t("Loading on") : t("Loading off")}
          </span>
          <ToggleSwitch
            on={config.load_pi_docs}
            onChange={(next) => void apply((prev) => ({ ...prev, load_pi_docs: next }))}
            label={t("Pi documentation")}
          />
        </div>
      </div>
    </>
  );
}