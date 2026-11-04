"use client";

import { useMemo, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ProviderGearIcon, ProviderIcon, hasProviderIcon } from "@/components/ui/ProviderIcon";
import {
  openModelsConfigAddProvider,
  openModelsConfigApiKey,
  openModelsConfigCatalog,
  openModelsConfigOAuth,
  selectModelsConfigProvider,
  setModelsConfigProviderFilter,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";
import {
  filterModelsConfigProviderRows,
  modelsConfigProviderRows,
  type ModelsConfigProviderKind,
  type ModelsConfigProviderRow,
} from "@/lib/shared/models-config-filter";
import type { ProviderEntry } from "@/lib/shared/models-config";

const GROUP_LABEL_KEY: Record<ModelsConfigProviderKind, string> = {
  subscription: "Subscriptions",
  apiKey: "API Key",
  custom: "Custom",
};

export function ModelsConfigProviderList() {
  const { t } = useI18n();
  const { view } = useModelsConfigPanel();
  const { config, oauthProviders, apiKeyProviders, providerFilter, selectedProvider } = view;

  const rows = useMemo(
    () =>
      modelsConfigProviderRows({
        oauthProviders,
        apiKeyProviders,
        providers: config.providers ?? {},
      }),
    [oauthProviders, apiKeyProviders, config.providers],
  );
  const visible = useMemo(
    () => filterModelsConfigProviderRows(rows, providerFilter),
    [rows, providerFilter],
  );

  const openRow = (row: ModelsConfigProviderRow) => {
    if (row.kind === "subscription") {
      openModelsConfigOAuth(row.id);
      return;
    }
    if (row.kind === "apiKey") {
      openModelsConfigApiKey(row.id);
      return;
    }
    selectModelsConfigProvider(row.id);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 10px 6px", flexShrink: 0 }}>
        <input
          value={providerFilter}
          onChange={(event) => setModelsConfigProviderFilter(event.target.value)}
          placeholder={t("Search providers...")}
          aria-label={t("Search providers...")}
          style={{
            width: "100%",
            padding: "5px 8px",
            background: "var(--bg-hover)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            color: "var(--text)",
            fontSize: 12,
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <NavRow
          icon={<CatalogIcon />}
          label={t("View all model data")}
          onClick={openModelsConfigCatalog}
        />
      </div>

      <div data-scroll-side style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 10px" }}>
        {visible.length === 0 ? (
          <div style={{ padding: "14px 4px", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
            {rows.length === 0 ? t("No providers configured") : t("No matching providers or models")}
          </div>
        ) : (
          (Object.keys(GROUP_LABEL_KEY) as ModelsConfigProviderKind[]).map((kind) => {
            const group = visible.filter((row) => row.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind} style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
                <div style={{ padding: "0 6px 4px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  {t(GROUP_LABEL_KEY[kind])}
                </div>
                {group.map((row) => (
                  <ProviderRow
                    key={`${row.kind}:${row.id}`}
                    row={row}
                    provider={kind === "custom" ? config.providers?.[row.id] : undefined}
                    selected={kind === "custom" && selectedProvider === row.id}
                    onClick={() => openRow(row)}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>

      <div style={{ padding: 10, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => openModelsConfigAddProvider()}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, width: "100%", padding: "7px 0", background: "none", border: "1px dashed var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
        >
          + {t("Add provider")}
        </button>
      </div>
    </div>
  );
}

function ProviderRow({
  row,
  provider,
  selected,
  onClick,
}: {
  row: ModelsConfigProviderRow;
  provider: ProviderEntry | undefined;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const iconId = provider?.icon;
  const resolved = iconId && hasProviderIcon(iconId) ? iconId : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 8px",
        background: selected ? "var(--bg-selected)" : "none",
        border: "none",
        borderRadius: 5,
        cursor: "pointer",
        textAlign: "left",
        color: "var(--text)",
      }}
      onMouseEnter={(event) => {
        if (!selected) event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        if (!selected) event.currentTarget.style.background = "none";
      }}
    >
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: "var(--text-muted)" }}>
        {resolved
          ? <ProviderIcon id={resolved} size={16} />
          : <ProviderGearIcon size={14} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
        {row.name}
      </span>
      <span style={{ flexShrink: 0, fontSize: 10, color: "var(--text-dim)" }}>
        {t("{n} models", { n: row.modelCount })}
      </span>
    </button>
  );
}

function NavRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", background: "none", border: "none", borderRadius: 5, cursor: "pointer", textAlign: "left", color: "var(--text)" }}
      onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = "none"; }}
    >
      {icon}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
        {label}
      </span>
    </button>
  );
}

function CatalogIcon() {
  return (
    <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: "var(--text-muted)" }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    </span>
  );
}
