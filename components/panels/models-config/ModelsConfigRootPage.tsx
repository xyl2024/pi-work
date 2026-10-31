"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ProviderIcon, ProviderGearIcon, hasProviderIcon } from "@/components/ui/ProviderIcon";
import {
  openModelsConfigAddProvider,
  openModelsConfigApiKey,
  openModelsConfigCatalog,
  openModelsConfigOAuth,
  openModelsConfigProvider,
  useModelsConfigPanel,
} from "@/lib/client/models-config-panel";

export function ModelsConfigRootPage() {
  const { t } = useI18n();
  const { config, oauthProviders, apiKeyProviders } = useModelsConfigPanel().view;

  const subscriptions = oauthProviders.filter((provider) => provider.loggedIn);
  const apiKeyConfigured = apiKeyProviders.filter((provider) => provider.configured);
  const providers = Object.entries(config.providers ?? {});

  const addProviderButton = (
    <button
      type="button"
      onClick={() => openModelsConfigAddProvider()}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, width: "100%", padding: "7px 0", background: "none", border: "1px dashed var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
    >
      + {t("Add provider")}
    </button>
  );

  const catalogRow = (
    <NavRow icon={<CatalogIcon />} label={t("View all model data")} onClick={openModelsConfigCatalog} />
  );

  if (subscriptions.length === 0 && apiKeyConfigured.length === 0 && providers.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 12px" }}>
        {catalogRow}
        <div style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
          {t("No providers configured")}
        </div>
        {addProviderButton}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "14px 12px" }}>
      {catalogRow}
      {subscriptions.length > 0 && (
        <Group label={t("Subscriptions")}>
          {subscriptions.map((provider) => (
            <NavRow
              key={provider.id}
              icon={<RowIcon iconId={provider.id} />}
              label={provider.name}
              onClick={() => openModelsConfigOAuth(provider.id)}
            />
          ))}
        </Group>
      )}

      {apiKeyConfigured.length > 0 && (
        <Group label={t("API Key")}>
          {apiKeyConfigured.map((provider) => (
            <NavRow
              key={provider.id}
              icon={<RowIcon iconId={provider.id} />}
              label={provider.displayName}
              onClick={() => openModelsConfigApiKey(provider.id)}
            />
          ))}
        </Group>
      )}

      {providers.length > 0 && (
        <Group label={t("Custom")}>
          {providers.map(([name, provider]) => (
            <div key={name}>
              <NavRow
                icon={<RowIcon iconId={provider.icon} />}
                label={name}
                onClick={() => openModelsConfigProvider(name)}
              />
              {(provider.models ?? []).map((model, index) => (
                <div key={index} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 8px 4px 26px" }}>
                  <RowIcon iconId={model.icon ?? provider.icon} size={13} />
                  <span style={rowLabelStyle(true)}>{model.id || t("new model")}</span>
                </div>
              ))}
            </div>
          ))}
        </Group>
      )}

      {addProviderButton}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ padding: "0 8px 4px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function NavRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={rowButtonStyle}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
    >
      {icon}
      <span style={rowLabelStyle(false)}>{label}</span>
      <Chevron />
    </button>
  );
}

function CatalogIcon() {
  return (
    <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: "var(--text-muted)" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    </span>
  );
}

function RowIcon({ iconId, size = 16 }: { iconId?: string; size?: number }) {
  const resolved = iconId && hasProviderIcon(iconId) ? iconId : undefined;
  return (
    <span style={{ flexShrink: 0, display: "flex", alignItems: "center", color: "var(--text-muted)" }}>
      {resolved
        ? <ProviderIcon id={resolved} size={size} />
        : <ProviderGearIcon size={Math.max(10, size - 2)} />}
    </span>
  );
}

function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, color: "var(--text-dim)" }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

const rowButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "6px 8px",
  background: "none",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
  textAlign: "left",
};

function rowLabelStyle(mono: boolean): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
    color: mono ? "var(--text-muted)" : "var(--text)",
    fontFamily: mono ? "var(--font-mono)" : "inherit",
  };
}
