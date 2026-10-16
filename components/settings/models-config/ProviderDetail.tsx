"use client";

import { useI18n } from "@/hooks/useI18n";
import { ModelEntryCard } from "./ModelEntryCard";
import type { ProviderEntry } from "./types";
import { SectionTitle } from "./form-fields";
import { ProviderFields } from "./ProviderFields";

export function ProviderDetail({ name, provider, onChange, onRename, onDelete, onSelectModel }: {
  name: string;
  provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void;
  onRename: (n: string) => void;
  onDelete: () => void;
  onSelectModel: (index: number) => void;
}) {
  const { t } = useI18n();
  const models = provider.models ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("Provider")}</SectionTitle>
        <button
          onClick={onDelete}
          style={{ padding: "3px 8px", background: "none", border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)", borderRadius: 4, color: "var(--error)", cursor: "pointer", fontSize: 11 }}
        >
          {t("Delete")}
        </button>
      </div>

      <ProviderFields name={name} provider={provider} onChange={onChange} onRename={onRename} />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <SectionTitle>{t("Models")}</SectionTitle>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{models.length}</span>
        </div>
        {models.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("No models")}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
            {models.map((model, index) => (
              <ModelEntryCard
                key={index}
                model={model}
                providerIcon={provider.icon}
                onOpen={() => onSelectModel(index)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
