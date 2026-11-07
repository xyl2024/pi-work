"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../../ui/Toast";
import { ProviderIcon, ProviderGearIcon } from "../../ui/ProviderIcon";
import { SectionTitle, SecretTextInput, Field, inputStyle } from "./form-fields";
import type { ApiKeyProvider, RuntimeCatalog, RuntimeCatalogProvider, RuntimeModelInfo } from "./types";

export function RuntimeModelCatalog() {
  const { t } = useI18n();
  const toast = useToast();
  const [catalog, setCatalog] = useState<RuntimeCatalog>({ providers: [], modelCount: 0 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/models${isRefresh ? "?refresh=true" : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { catalog?: RuntimeCatalog };
      setCatalog(data.catalog ?? { providers: [], modelCount: 0 });
      if (isRefresh) toast.show({ kind: "success", message: t("Catalog refreshed") });
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : t("Failed to load model catalog");
      setError(message);
      if (isRefresh) toast.show({ kind: "error", message });
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const query = search.trim().toLowerCase();
  const visibleProviders = useMemo(() => catalog.providers.map((provider) => {
    if (!query) return provider;
    const providerMatches = `${provider.id} ${provider.name} ${JSON.stringify({ ...provider, models: undefined })}`
      .toLowerCase()
      .includes(query);
    const models = providerMatches ? provider.models : provider.models.filter((model) => JSON.stringify(model).toLowerCase().includes(query));
    return models.length > 0 || providerMatches ? { ...provider, models } : null;
  }).filter((provider): provider is RuntimeCatalogProvider => provider !== null), [catalog.providers, query]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }} />
        <input
          type="search"
          name="model-catalog-filter"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Search providers and models...")}
          style={{ ...inputStyle, width: 230, flexShrink: 1 }}
        />
        <button
          onClick={() => { void loadCatalog(true); }}
          disabled={loading || refreshing}
          style={{ padding: "6px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: loading || refreshing ? "default" : "pointer", fontSize: 11, flexShrink: 0 }}
        >
          {refreshing ? t("Refreshing...") : t("Refresh catalog")}
        </button>
      </div>

      <div data-scroll-wide style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
        {loading ? (
          <div style={{ padding: 20, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>{t("Loading catalog...")}</div>
        ) : error ? (
          <div style={{ padding: 20, color: "var(--error)", fontSize: 12, textAlign: "center" }}>{error}</div>
        ) : visibleProviders.length === 0 ? (
          <div style={{ padding: 20, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
            {query ? t("No matching providers or models") : t("No catalog data")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleProviders.map((provider) => (
              <details key={provider.id} style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)" }}>
                <summary style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "9px 11px", color: "var(--text)", fontSize: 12 }}>
                  <ProviderIcon id={provider.id} size={17} fallback={<ProviderGearIcon size={14} />} />
                  <strong>{provider.name}</strong>
                  <code style={{ color: "var(--text-dim)", fontSize: 10 }}>{provider.id}</code>
                  <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 10 }}>
                    {t("{n} models", { n: provider.models.length })}
                  </span>
                  <span style={{ color: provider.auth.configured ? "var(--success)" : "var(--text-dim)", fontSize: 10 }}>
                    {provider.auth.configured ? t("Configured") : t("Not configured")}
                  </span>
                </summary>
                <div style={{ padding: "0 11px 11px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 10, color: "var(--text-muted)" }}>
                    <span>{provider.dynamic ? t("Dynamic catalog") : t("Static catalog")}</span>
                    {provider.baseUrl && <code style={{ wordBreak: "break-all" }}>{provider.baseUrl}</code>}
                    {provider.auth.source && <span>{provider.auth.source}</span>}
                  </div>
                  <details>
                    <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 10 }}>{t("Provider metadata")}</summary>
                    <pre style={{ margin: "6px 0 0", padding: 8, maxHeight: 220, overflow: "auto", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", fontSize: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {JSON.stringify({ ...provider, models: undefined }, null, 2)}
                    </pre>
                  </details>
                  {provider.models.length === 0 ? (
                    <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{t("No models")}</div>
                  ) : provider.models.map((model) => (
                    <details key={`${model.provider}:${model.id}`} style={{ border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)" }}>
                      <summary style={{ cursor: "pointer", padding: "7px 9px", color: "var(--text)", fontSize: 11 }}>
                        <strong>{model.name}</strong>
                        <code style={{ marginLeft: 7, color: "var(--text-dim)", fontSize: 10 }}>{model.id}</code>
                      </summary>
                      <pre style={{ margin: 0, padding: "0 9px 9px", maxHeight: 420, overflow: "auto", color: "var(--text-muted)", fontSize: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {JSON.stringify(model, null, 2)}
                      </pre>
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("API Key")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.configured ? "var(--success)" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: provider.configured ? "var(--success)" : "var(--text-dim)" }}>
            {provider.configured ? t("configured") : t("not configured")}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {provider.configured
          ? t("API key stored message")
          : `${t("Enter your")} ${provider.displayName} API key ${t("to enable")} ${provider.modelCount} ${t("models")}.`}
      </p>

      <Field label="API Key">
        <div style={{ display: "flex", gap: 6 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleSave(); }}
            placeholder={provider.configured ? t("Enter new key to replace...") : "sk-..."}
            style={{ flex: 1 }}
            autoComplete="new-password"
            spellCheck={false}
            mono
          />
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
            style={{
              padding: "6px 12px",
              background: savedOk ? "var(--success)" : apiKey.trim() ? "var(--accent)" : "var(--bg)",
              border: "none", borderRadius: 5,
              color: (apiKey.trim() || savedOk) ? "#fff" : "var(--text-dim)",
              cursor: (saving || !apiKey.trim() || savedOk) ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 600, flexShrink: 0,
              display: "flex", alignItems: "center", gap: 5,
            }}
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

      {error && <p style={{ margin: 0, fontSize: 12, color: "var(--error)" }}>{error}</p>}

      {provider.configured && (
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start", padding: "5px 12px",
            background: "none", border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)",
            borderRadius: 5, color: "var(--error)",
            cursor: removing ? "not-allowed" : "pointer", fontSize: 12,
          }}
        >
          {removing ? t("Removing...") : t("Disconnect")}
        </button>
      )}
    </div>
  );
}
