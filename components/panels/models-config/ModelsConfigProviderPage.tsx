"use client";

import { useI18n } from "@/hooks/useI18n";
import { ProviderFields } from "@/components/settings/models-config/ProviderFields";
import {
  deleteModelsConfigProvider,
  modelsConfigBack,
  renameModelsConfigProvider,
  updateModelsConfigProvider,
  useModelsConfigStore,
} from "@/lib/client/models-config-store";

/**
 * One provider's detail page. Full width, with a back control that returns to
 * the provider list — the panel navigates in levels instead of the modal's
 * 210px sidebar plus a detail column.
 *
 * The model grid and its "open a model" navigation belong to the model-detail
 * slice; this page covers the fields the provider slice asks for (name, icon,
 * Base URL, API), plus the provider's own API key.
 */
export function ModelsConfigProviderPage({ name }: { name: string }) {
  const { t } = useI18n();
  const { config } = useModelsConfigStore();
  const provider = config.providers?.[name];
  if (!provider) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={modelsConfigBack}
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 6 9 12 15 18" />
          </svg>
          {t("Back")}
        </button>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
          {name}
        </span>
        <button
          type="button"
          onClick={() => deleteModelsConfigProvider(name)}
          style={{ padding: "3px 8px", background: "none", border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)", borderRadius: 4, color: "var(--error)", cursor: "pointer", fontSize: 11, flexShrink: 0 }}
        >
          {t("Delete")}
        </button>
      </div>

      <ProviderFields
        name={name}
        provider={provider}
        onChange={(next) => updateModelsConfigProvider(name, next)}
        onRename={(nextName) => renameModelsConfigProvider(name, nextName)}
      />
    </div>
  );
}
