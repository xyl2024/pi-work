"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ProviderIcon, ProviderGearIcon, hasProviderIcon } from "@/components/ui/ProviderIcon";
import { openModelsConfigProvider, useModelsConfigStore } from "@/lib/client/models-config-store";

/**
 * The panel's root page: every provider the user can configure, in one
 * full-width list. Three groups, in the order the modal used to stack them —
 * subscription providers already logged in, API-key providers already
 * configured, then the user's own providers with their model entries.
 *
 * Subscription and API-key rows become navigable in the OAuth / API-key slice;
 * here they are what the acceptance criteria ask for — visible — while the
 * custom-provider rows already open their detail page.
 */
export function ModelsConfigRootPage() {
  const { t } = useI18n();
  const { config, oauthProviders, apiKeyProviders } = useModelsConfigStore();

  const subscriptions = oauthProviders.filter((provider) => provider.loggedIn);
  const apiKeyConfigured = apiKeyProviders.filter((provider) => provider.configured);
  const providers = Object.entries(config.providers ?? {});

  if (subscriptions.length === 0 && apiKeyConfigured.length === 0 && providers.length === 0) {
    return (
      <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
        {t("No providers configured")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "14px 12px" }}>
      {subscriptions.length > 0 && (
        <Group label={t("Subscriptions")}>
          {subscriptions.map((provider) => (
            <StaticRow
              key={provider.id}
              iconId={provider.id}
              label={provider.name}
              trailing={t("Configured")}
            />
          ))}
        </Group>
      )}

      {apiKeyConfigured.length > 0 && (
        <Group label={t("API Key")}>
          {apiKeyConfigured.map((provider) => (
            <StaticRow
              key={provider.id}
              iconId={provider.id}
              label={provider.displayName}
              trailing={t("Configured")}
            />
          ))}
        </Group>
      )}

      {providers.length > 0 && (
        <Group label={t("Custom")}>
          {providers.map(([name, provider]) => (
            <div key={name}>
              <button
                type="button"
                onClick={() => openModelsConfigProvider(name)}
                style={rowButtonStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                <RowIcon iconId={provider.icon} />
                <span style={rowLabelStyle(false)}>{name}</span>
                <Chevron />
              </button>
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

function StaticRow({ iconId, label, trailing }: { iconId?: string; label: string; trailing?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px" }}>
      <RowIcon iconId={iconId} />
      <span style={rowLabelStyle(false)}>{label}</span>
      {trailing && <span style={{ flexShrink: 0, fontSize: 10, color: "var(--text-dim)" }}>{trailing}</span>}
    </div>
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
