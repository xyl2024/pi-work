"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../Toast";
import { ProviderIcon, ProviderGearIcon } from "../ProviderIcon";
import { SectionTitle, SecretTextInput, Field, inputStyle } from "./form-fields";
import type { ApiKeyProvider, OAuthProvider, RuntimeCatalog, RuntimeCatalogProvider, RuntimeModelInfo } from "./types";
import { getDisplayedThinkingLevels } from "./utils";

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
    const providerMatches = `${provider.id} ${provider.name} ${JSON.stringify(provider)}`.toLowerCase().includes(query);
    const models = providerMatches ? provider.models : provider.models.filter((model) => JSON.stringify(model).toLowerCase().includes(query));
    return models.length > 0 || providerMatches ? { ...provider, models } : null;
  }).filter((provider): provider is RuntimeCatalogProvider => provider !== null), [catalog.providers, query]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("{n} providers", { n: catalog.providers.length })} · {t("{n} models", { n: catalog.modelCount })}
          </div>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Search providers and models...")}
          style={{ ...inputStyle, width: 230, flexShrink: 1 }}
        />
        <button
          onClick={() => { void loadCatalog(true); }}
          disabled={loading || refreshing}
          style={{ padding: "6px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: loading || refreshing ? "default" : "pointer", fontSize: 11, flexShrink: 0 }}
        >
          {refreshing ? t("Refreshing...") : t("Refresh catalog")}
        </button>
      </div>

      <div data-scroll-wide style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
        {loading ? (
          <div style={{ padding: 20, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>{t("Loading catalog...")}</div>
        ) : error ? (
          <div style={{ padding: 20, color: "#f87171", fontSize: 12, textAlign: "center" }}>{error}</div>
        ) : visibleProviders.length === 0 ? (
          <div style={{ padding: 20, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
            {query ? t("No matching providers or models") : t("No catalog data")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleProviders.map((provider) => (
              <details key={provider.id} style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-panel)" }}>
                <summary style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "9px 11px", color: "var(--text)", fontSize: 12 }}>
                  <ProviderIcon id={provider.id} size={17} fallback={<ProviderGearIcon size={14} />} />
                  <strong>{provider.name}</strong>
                  <code style={{ color: "var(--text-dim)", fontSize: 10 }}>{provider.id}</code>
                  <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 10 }}>
                    {t("{n} models", { n: provider.models.length })}
                  </span>
                  <span style={{ color: provider.auth.configured ? "#4ade80" : "var(--text-dim)", fontSize: 10 }}>
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

export function ModelCatalogPicker({
  onSelect,
  onClose,
}: {
  onSelect: (model: RuntimeModelInfo) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [models, setModels] = useState<Array<{ model: RuntimeModelInfo; providerName: string }>>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
    let cancelled = false;
    fetch("/api/models", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((data: { catalog?: RuntimeCatalog }) => {
        if (cancelled) return;
        setModels((data.catalog?.providers ?? []).flatMap((provider) =>
          provider.models.map((model) => ({ model, providerName: provider.name })),
        ));
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof Error && e.message ? e.message : t("Failed to load model catalog");
        setError(message);
        toast.show({ kind: "error", message });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t, toast]);

  const query = search.trim().toLowerCase();
  const visibleModels = useMemo(() => models.filter(({ model, providerName }) => {
    if (!query) return true;
    return `${providerName} ${model.provider} ${JSON.stringify(model)}`.toLowerCase().includes(query);
  }), [models, query]);
  const displayedModels = visibleModels.slice(0, 200);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: 760, maxWidth: "calc(100vw - 32px)", height: "min(76vh, calc(100vh - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div>
            <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 700 }}>{t("Fill from model catalog")}</div>
            <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11 }}>{t("Only model fields are filled; provider settings stay unchanged.")}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            placeholder={t("Search all providers and models...")}
            style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
          />
          {!loading && !error && <div style={{ marginTop: 5, color: "var(--text-dim)", fontSize: 10 }}>{t("{n} matching models", { n: visibleModels.length })}</div>}
        </div>

        <div data-scroll-wide style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
          {loading ? (
            <div style={{ padding: 20, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>{t("Loading catalog...")}</div>
          ) : error ? (
            <div style={{ padding: 20, color: "#f87171", fontSize: 12, textAlign: "center" }}>{error}</div>
          ) : displayedModels.length === 0 ? (
            <div style={{ padding: 20, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>{t("No matching providers or models")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {displayedModels.map(({ model, providerName }) => (
                <button
                  key={`${model.provider}:${model.id}`}
                  onClick={() => onSelect(model)}
                  style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "9px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <ProviderIcon id={model.provider} size={20} fallback={<ProviderGearIcon size={16} />} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }}>{model.name}</span>
                    <span style={{ display: "block", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{model.provider} / {model.id}</span>
                  </span>
                  <span style={{ color: "var(--text-muted)", fontSize: 10, flexShrink: 0 }}>{providerName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RuntimeModelList({ providerId, configured }: { providerId: string; configured: boolean }) {
  const { t } = useI18n();
  const [models, setModels] = useState<RuntimeModelInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/models")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { modelList?: RuntimeModelInfo[] }) => {
        if (!cancelled) setModels((data.modelList ?? []).filter((model) => model.provider === providerId));
      })
      .catch(() => { if (!cancelled) setModels([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [providerId, configured]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
      <SectionTitle>{t("Available models")}</SectionTitle>
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("Loading models...")}</div>
      ) : models.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("No available models")}</div>
      ) : models.map((model) => (
        <details key={model.id} style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)" }}>
          <summary style={{ cursor: "pointer", padding: "8px 10px", color: "var(--text)", fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>{model.name}</span>
            <span style={{ marginLeft: 8, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{model.id}</span>
          </summary>
          <div style={{ padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, fontSize: 11 }}>
              <span style={{ color: "var(--text-muted)" }}>{t("API")}: <b style={{ color: "var(--text)" }}>{model.api}</b></span>
              <span style={{ color: "var(--text-muted)" }}>{t("Context window")}: <b style={{ color: "var(--text)" }}>{model.contextWindow.toLocaleString()}</b></span>
              <span style={{ color: "var(--text-muted)" }}>{t("Max output")}: <b style={{ color: "var(--text)" }}>{model.maxTokens.toLocaleString()}</b></span>
              <span style={{ color: "var(--text-muted)" }}>{t("Input")}: <b style={{ color: "var(--text)" }}>{model.input.join(", ")}</b></span>
              <span style={{ color: "var(--text-muted)" }}>{t("Reasoning")}: <b style={{ color: "var(--text)" }}>{model.reasoning ? t("Supported") : t("Not supported")}</b></span>
              <span style={{ color: "var(--text-muted)" }}>{t("Thinking levels")}: <b style={{ color: "var(--text)" }}>{getDisplayedThinkingLevels(model).join(", ") || t("Provider default")}</b></span>
            </div>
            <div>
              <SectionTitle>{t("Cost (per million tokens)")}</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 6, fontSize: 10 }}>
                {(["input", "output", "cacheRead", "cacheWrite"] as const).map((key) => (
                  <div key={key} style={{ padding: "6px 7px", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)" }}>
                    <div>{key}</div>
                    <b style={{ display: "block", marginTop: 3, color: "var(--text)" }}>{model.cost?.[key] ?? "—"}</b>
                  </div>
                ))}
              </div>
              {model.cost?.tiers && model.cost.tiers.length > 0 && (
                <div style={{ marginTop: 7, fontSize: 10, color: "var(--text-muted)" }}>
                  <div style={{ marginBottom: 4 }}>{t("Cost tiers")}</div>
                  <pre style={{ margin: 0, padding: 7, maxHeight: 120, overflow: "auto", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {JSON.stringify(model.cost.tiers, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, fontSize: 11 }}>
              <span style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>{t("Base URL")}: <b style={{ color: "var(--text)" }}>{model.baseUrl || "—"}</b></span>
              <span style={{ color: "var(--text-muted)" }}>{t("Headers")}: <b style={{ color: "var(--text)" }}>{Object.keys(model.headers ?? {}).length || 0}</b></span>
              <span style={{ color: "var(--text-muted)" }}>{t("Compatibility")}: <b style={{ color: "var(--text)" }}>{Object.keys(model.compat ?? {}).length || 0}</b></span>
            </div>
            <details>
              <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 10 }}>{t("Raw metadata")}</summary>
              <pre style={{ margin: "6px 0 0", padding: 8, maxHeight: 220, overflow: "auto", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", fontSize: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {JSON.stringify({ headers: model.headers, compat: model.compat, thinkingLevelMap: model.thinkingLevelMap }, null, 2)}
              </pre>
            </details>
          </div>
        </details>
      ))}
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
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.configured ? "#4ade80" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: provider.configured ? "#4ade80" : "var(--text-dim)" }}>
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
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
            style={{
              padding: "6px 12px",
              background: savedOk ? "#16a34a" : apiKey.trim() ? "var(--accent)" : "var(--bg-panel)",
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

      {error && <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{error}</p>}

      <RuntimeModelList providerId={provider.id} configured={provider.configured} />

      {provider.configured && (
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start", padding: "5px 12px",
            background: "none", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 5, color: "#ef4444",
            cursor: removing ? "not-allowed" : "pointer", fontSize: 12,
          }}
        >
          {removing ? t("Removing...") : t("Disconnect")}
        </button>
      )}
    </div>
  );
}

interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}

export function AddProviderPicker({
  oauthProviders, apiKeyProviders,
  onSelectOAuth, onSelectApiKey, onAddCustom, onClose,
}: AddProviderPickerProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const q = search.trim().toLowerCase();
  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)));
  const availableApiKey = apiKeyProviders.filter((p) => !p.configured && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);
  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const cardStyle: React.CSSProperties = {
    display: "flex", flexDirection: "row", alignItems: "center", gap: 8,
    padding: "10px 12px",
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    boxSizing: "border-box",
    cursor: "pointer",
    minWidth: 0,
    textAlign: "left",
    transition: "border-color 0.12s, background 0.12s",
    width: "100%",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: 820, maxWidth: "calc(100vw - 32px)", maxHeight: "min(72vh, calc(100vh - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            placeholder={t("Search providers...")}
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
          />
        </div>

        <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {totalCount === 0 ? (
            <div style={{ padding: "20px 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>{t("No providers match")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 8 }}>
              {showCustom && (
                <div style={{ gridColumn: "1 / -1", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("Custom")}</div>
              )}
              {showCustom && (
                <button
                  onClick={() => { onAddCustom(); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("OpenAI / Anthropic compatible")}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{t("Custom endpoint format")}</div>
                  </div>
                  <span style={{ width: 26, height: 26, borderRadius: 5, background: "var(--bg-hover)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)" }}>
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: showCustom ? 6 : 0, fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("Subscriptions")}</div>
              )}
              {availableOAuth.map((p) => (
                <button key={p.id} onClick={() => { onSelectOAuth(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>OAuth</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableOAuth.length > 0 ? 6 : 0, fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("API Key")}</div>
              )}
              {availableApiKey.map((p) => (
                <button key={p.id} onClick={() => { onSelectApiKey(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{p.modelCount} models</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
