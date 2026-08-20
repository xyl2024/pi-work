"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useToast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";
import { ProviderIcon, ProviderGearIcon, hasProviderIcon } from "../ui/ProviderIcon";
import { ProviderDetail } from "./models-config/ProviderDetail";
import { ModelDetail } from "./models-config/ModelDetail";
import { OAuthDetail } from "./models-config/OAuthDetail";
import { RuntimeModelCatalog, ApiKeyDetail, AddProviderPicker } from "./models-config/runtime";
import type { ApiKeyProvider, ModelsJson, OAuthProvider, Selection, ModelEntry, ProviderEntry } from "./models-config/types";

export function ModelsConfig({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { requestClose, backdropStyle, panelStyle } = useModalAnimation({
    isOpen: true,
    onClose,
  });
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const loadOAuthProviders = useCallback(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { providers: OAuthProvider[] }) => setOauthProviders(d.providers))
      .catch(() => {});
  }, []);

  const loadApiKeyProviders = useCallback(() => {
    fetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers: ApiKeyProvider[] }) => setApiKeyProviders(d.providers))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/models-config")
      .then((r) => r.json())
      .then((d: ModelsJson) => {
        const normalized = d.providers ? d : { ...d, providers: {} };
        setConfig(normalized);
        const keys = Object.keys(normalized.providers ?? {});
        if (keys.length > 0) setSelection({ type: "provider", name: keys[0] });
      })
      .catch(() => {
        setConfig({ providers: {} });
        toast.show({ kind: "error", message: t("Failed to load models") });
      })
      .finally(() => setLoading(false));
    loadOAuthProviders();
    loadApiKeyProviders();
  }, [loadOAuthProviders, loadApiKeyProviders, t, toast]);

  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } } }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, provider: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: provider } }));
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    setConfig((prev) => {
      const entries = Object.entries(prev.providers ?? {});
      const idx = entries.findIndex(([key]) => key === oldName);
      if (idx === -1) return prev;
      entries[idx] = [newName, entries[idx][1]];
      return { ...prev, providers: Object.fromEntries(entries) };
    });
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
  }, []);

  const deleteProvider = useCallback((name: string) => {
    setConfig((prev) => {
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      const next = { ...prev, providers };
      setSelection(Object.keys(providers).length > 0 ? { type: "provider", name: Object.keys(providers)[0] } : null);
      return next;
    });
  }, []);

  const addModel = useCallback((providerName: string) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? []), { id: "" }];
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
    setConfig((prev) => {
      const index = (prev.providers?.[providerName]?.models?.length ?? 1) - 1;
      setSelection({ type: "model", providerName, index });
      return prev;
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, model: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = model;
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
    });
    setSelection({ type: "provider", name: providerName });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const body = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || body.error) {
        setSaveError(body.error ?? `HTTP ${res.status}`);
        toast.show({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
      } else {
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        toast.show({ kind: "success", message: t("Models saved") });
      }
    } catch (e) {
      setSaveError(String(e));
      toast.show({ kind: "error", message: String(e) });
    } finally {
      setSaving(false);
    }
  }, [config, t, toast]);

  const providers = Object.entries(config.providers ?? {});
  const activeOAuth = oauthProviders.filter((provider) => provider.loggedIn);
  const activeApiKey = apiKeyProviders.filter((provider) => provider.configured);

  const modelCatalogSourceTooltip = (
    <div style={{ maxWidth: 260, display: "flex", flexDirection: "column", gap: 7, fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>
      <div style={{ fontWeight: 700 }}>{t("About model catalog sources")}</div>
      <div>{t("Pi's pi-ai SDK builds the static catalog with generate-models.ts. It combines external catalogs with Pi-maintained provider-specific overrides, then generates the bundled model metadata files.")}</div>
      <div style={{ fontWeight: 600 }}>{t("Build-time sources")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div>• {t("Base model metadata")}: <code>https://models.dev/api.json</code></div>
        <div>• {t("OpenRouter model list")}: <code>https://openrouter.ai/api/v1/models</code></div>
        <div>• {t("NVIDIA NIM model list")}: <code>https://integrate.api.nvidia.com/v1/models</code></div>
        <div>• {t("Vercel AI Gateway model list")}: <code>https://ai-gateway.vercel.sh/v1/models</code></div>
      </div>
      <div>{t("Generated files")}: <code>src/providers/data/*.json</code> → <code>src/providers/*.models.ts</code> → <code>src/models.generated.ts</code></div>
      <div>{t("At runtime, pi-coding-agent loads the bundled static catalog. An optional refresh can fetch newer entries from pi.dev and cache them in ~/.pi/agent/models-store.json.")}</div>
    </div>
  );

  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const provider = oauthProviders.find((item) => item.id === selection.providerId);
      if (!provider) return null;
      return <OAuthDetail key={provider.id} provider={provider} onRefresh={loadOAuthProviders} />;
    }
    if (selection.type === "apikey") {
      const provider = apiKeyProviders.find((item) => item.id === selection.providerId);
      if (!provider) return null;
      return <ApiKeyDetail key={provider.id} provider={provider} onRefresh={loadApiKeyProviders} />;
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          provider={provider}
          onChange={(next) => updateProvider(selection.name, next)}
          onRename={(nextName) => renameProvider(selection.name, nextName)}
          onDelete={() => deleteProvider(selection.name)}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        model={model}
        onChange={(next) => updateModel(selection.providerName, selection.index, next)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
      />
    );
  })();

  return (
    <>
      <div
        style={backdropStyle}
        onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
      >
        <div style={{ ...panelStyle, width: 860, height: "78vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
              {catalogOpen && (
                <button
                  onClick={() => setCatalogOpen(false)}
                  style={{ padding: "3px 7px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 11, flexShrink: 0 }}
                >
                  ← {t("Back to configuration")}
                </button>
              )}
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{catalogOpen ? t("All model data") : t("Models")}</span>
              {!catalogOpen && <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>~/.pi/agent/models.json</code>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <Tooltip content={modelCatalogSourceTooltip} side="bottom" align="end" delayDuration={300} interactive>
                <button
                  type="button"
                  aria-label={t("About model catalog sources")}
                  style={{ width: 22, height: 22, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--text-dim)", borderRadius: "50%", background: "transparent", color: "var(--text-muted)", cursor: "help", fontSize: 13, fontWeight: 700, lineHeight: 1 }}
                >
                  ?
                </button>
              </Tooltip>
              {!catalogOpen && (
                <button
                  onClick={() => setCatalogOpen(true)}
                  style={{ padding: "5px 9px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                >
                  {t("View all model data")}
                </button>
              )}
              <button onClick={requestClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
            </div>
          </div>

          {catalogOpen ? <RuntimeModelCatalog /> : (
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div style={{ width: 210, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--bg-panel)" }}>
                <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
                  {activeOAuth.map((provider) => {
                    const isSelected = selection?.type === "oauth" && selection.providerId === provider.id;
                    return (
                      <div
                        key={provider.id}
                        onClick={() => setSelection({ type: "oauth", providerId: provider.id })}
                        style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                      >
                        <ProviderIcon id={provider.id} size={16} />
                        <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.name}</span>
                      </div>
                    );
                  })}

                  {activeApiKey.map((provider) => {
                    const isSelected = selection?.type === "apikey" && selection.providerId === provider.id;
                    return (
                      <div
                        key={provider.id}
                        onClick={() => setSelection({ type: "apikey", providerId: provider.id })}
                        style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                      >
                        <ProviderIcon id={provider.id} size={16} />
                        <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.displayName}</span>
                      </div>
                    );
                  })}

                  {(activeOAuth.length > 0 || activeApiKey.length > 0) && providers.length > 0 && (
                    <div style={{ margin: "4px 8px", borderTop: "1px solid var(--border)" }} />
                  )}

                  {loading ? (
                    <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("Loading...")}</div>
                  ) : providers.map(([providerName, providerData]) => {
                    const isProviderSelected = selection?.type === "provider" && selection.name === providerName;
                    const models = providerData.models ?? [];
                    const providerIcon = providerData.icon && hasProviderIcon(providerData.icon) ? providerData.icon : "";
                    return (
                      <div key={providerName} style={{ marginBottom: 2 }}>
                        <div
                          onClick={() => setSelection({ type: "provider", name: providerName })}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderRadius: 5, cursor: "pointer", background: isProviderSelected ? "var(--bg-selected)" : "none" }}
                          onMouseEnter={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "none"; }}
                        >
                          <ProviderIcon id={providerIcon} size={13} fallback={<ProviderGearIcon size={11} />} />
                          <span style={{ fontSize: 12, fontWeight: isProviderSelected ? 600 : 400, color: "var(--text)", fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {providerName}
                          </span>
                        </div>

                        {models.map((model, index) => {
                          const isModelSelected = selection?.type === "model" && selection.providerName === providerName && selection.index === index;
                          const modelIcon = (model.icon && hasProviderIcon(model.icon)) ? model.icon : providerIcon;
                          return (
                            <div
                              key={index}
                              onClick={() => setSelection({ type: "model", providerName, index })}
                              style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 26px", borderRadius: 5, cursor: "pointer", background: isModelSelected ? "var(--bg-selected)" : "none" }}
                              onMouseEnter={(e) => { if (!isModelSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                              onMouseLeave={(e) => { if (!isModelSelected) e.currentTarget.style.background = "none"; }}
                            >
                              <ProviderIcon id={modelIcon} size={11} fallback={<ProviderGearIcon size={10} />} />
                              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: model.id ? "var(--text-muted)" : "var(--text-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {model.id || t("new model")}
                              </span>
                              {model.reasoning && (
                                <span style={{ fontSize: 9, padding: "1px 4px", background: "rgba(99,102,241,0.12)", color: "rgba(99,102,241,0.8)", borderRadius: 3, flexShrink: 0 }}>T</span>
                              )}
                            </div>
                          );
                        })}

                        <div
                          onClick={(e) => { e.stopPropagation(); addModel(providerName); }}
                          style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px 4px 26px", borderRadius: 5, cursor: "pointer", color: "var(--text-dim)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                        >
                          <span style={{ fontSize: 11 }}>+ {t("Model")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ borderTop: "1px solid var(--border)", padding: "8px 6px" }}>
                  <button
                    onClick={() => setPickerOpen(true)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                      width: "100%", padding: "6px 0", background: "none", border: "1px dashed var(--border)", borderRadius: 5,
                      color: "var(--text-muted)", cursor: "pointer", fontSize: 12,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
                  >
                    + {t("Add provider")}
                  </button>
                </div>
              </div>

              <div data-scroll-wide style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                {loading ? null : detailContent ?? (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
                    {t("Select a provider or model")}
                  </div>
                )}
              </div>
            </div>
          )}

          {!catalogOpen && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
              {saveError && <span style={{ fontSize: 12, color: "#f87171", flex: 1 }}>{saveError}</span>}
              <button onClick={requestClose} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
                {t("Cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || savedOk}
                style={{
                  position: "relative",
                  padding: "6px 16px",
                  minWidth: 92,
                  background: savedOk ? "#16a34a" : saving ? "var(--bg-panel)" : "var(--accent)",
                  border: "none", borderRadius: 6,
                  color: savedOk ? "#fff" : saving ? "var(--text-muted)" : "#fff",
                  cursor: (saving || savedOk) ? "default" : "pointer", fontSize: 13, fontWeight: 600,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "background-color 0.2s ease, color 0.2s ease",
                  animation: savedOk ? "saved-pop 0.45s ease" : undefined,
                }}
              >
                {savedOk && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards", flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span>{savedOk ? t("Saved") : saving ? t("Saving...") : t("Save")}</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {pickerOpen && (
        <AddProviderPicker
          oauthProviders={oauthProviders}
          apiKeyProviders={apiKeyProviders}
          onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
          onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
          onAddCustom={addCustomProvider}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
