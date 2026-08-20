"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "../../ui/Toast";
import { Tooltip } from "../../ui/Tooltip";
import { copyText } from "@/lib/client/clipboard";
import { API_OPTIONS } from "./constants";
import type { ModelEntry, RuntimeModelInfo } from "./types";
import { Field, TextInput, NumInput, Check, SectionTitle, IconField, Select } from "./form-fields";
import { ThinkingLevelMapEditor } from "./ThinkingLevelMapEditor";
import { cloneModelFromCatalog, hasDeepseekCompat, setDeepseekCompat } from "./utils";
import { ModelCatalogPicker } from "./runtime";

export function ModelDetail({ model, onChange, onDelete }: { model: ModelEntry; onChange: (m: ModelEntry) => void; onDelete: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [fillPickerOpen, setFillPickerOpen] = useState(false);
  const [rawEditMode, setRawEditMode] = useState(false);
  const [rawDraft, setRawDraft] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);
  const rawJson = useMemo(() => JSON.stringify(model, null, 2), [model]);
  const enterRawEditMode = () => {
    setRawDraft(rawJson);
    setRawError(null);
    setRawEditMode(true);
  };
  const applyRawDraft = () => {
    try {
      const parsed = JSON.parse(rawDraft) as ModelEntry;
      const cleaned: ModelEntry = { ...parsed, id: parsed.id ?? "" };
      if (cleaned.icon === "" || cleaned.icon === null) delete (cleaned as { icon?: string }).icon;
      onChange(cleaned);
      setRawEditMode(false);
      setRawError(null);
      toast.show({ kind: "success", message: t("Raw metadata applied") });
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : t("Invalid JSON");
      setRawError(message);
    }
  };
  const copyRawJson = async () => {
    try {
      await copyText(rawJson);
      toast.show({ kind: "success", message: t("Copied") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error ? e.message : t("Network error") });
    }
  };
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const fillFromCatalog = (source: RuntimeModelInfo) => {
    onChange(cloneModelFromCatalog(source));
    setFillPickerOpen(false);
  };
  const costVal = (k: keyof NonNullable<ModelEntry["cost"]>) => model.cost?.[k] !== undefined ? String(model.cost[k]) : "";
  const setCost = (k: keyof NonNullable<ModelEntry["cost"]>, v: string) => {
    const n = parseFloat(v);
    onChange({ ...model, cost: { ...(model.cost ?? {}), [k]: isNaN(n) ? undefined : n } });
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <SectionTitle>{t("Model")}</SectionTitle>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setFillPickerOpen(true)}
              style={{ padding: "3px 8px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11 }}
            >
              {t("Fill from model catalog")}
            </button>
            <button
              onClick={onDelete}
              style={{ padding: "3px 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 11 }}
            >
              {t("Delete")}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label={t("ID *")}><TextInput value={model.id} onChange={(v) => set("id", v)} placeholder={t("model-id")} mono /></Field>
          <Field label={t("Name")}><TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder={t("Display name")} /></Field>
        </div>

        <IconField value={model.icon} onChange={(v) => set("icon", v)} />

        <Field label={t("API override")}>
          <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
        </Field>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Check label="Reasoning / thinking" checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
          <Check label="Image input" checked={model.input?.includes("image") ?? false} onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
        </div>

        {model.reasoning && (
          <>
            <Check label="DeepSeek thinking compat" checked={hasDeepseekCompat(model)} onChange={(v) => onChange(setDeepseekCompat(model, v))} />
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <SectionTitle>{t("Thinking level map")}</SectionTitle>
                {model.thinkingLevelMap && (
                  <button
                    onClick={() => set("thinkingLevelMap", undefined)}
                    style={{ fontSize: 10, padding: "2px 7px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer" }}
                  >
                    clear all
                  </button>
                )}
              </div>
              <ThinkingLevelMapEditor value={model.thinkingLevelMap} onChange={(v) => set("thinkingLevelMap", v)} />
            </div>
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Context window (tokens)">
            <NumInput value={model.contextWindow !== undefined ? String(model.contextWindow) : ""} onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)} placeholder="128000" />
          </Field>
          <Field label="Max output tokens">
            <NumInput value={model.maxTokens !== undefined ? String(model.maxTokens) : ""} onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)} placeholder="16384" />
          </Field>
        </div>

        <div>
          <SectionTitle>{t("Cost (per million tokens)")}</SectionTitle>
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
              <Field key={k} label={k}>
                <NumInput value={costVal(k)} onChange={(v) => setCost(k, v)} placeholder="0" />
              </Field>
            ))}
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <SectionTitle>{t("Raw metadata")}</SectionTitle>
            <div style={{ display: "flex", gap: 6 }}>
              {!rawEditMode && (
                <>
                  <Tooltip content={t("Copy raw JSON")}>
                    <button
                      type="button"
                      onClick={copyRawJson}
                      aria-label={t("Copy raw JSON")}
                      style={{ padding: "3px 7px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      {t("Copy")}
                    </button>
                  </Tooltip>
                  <button
                    type="button"
                    onClick={enterRawEditMode}
                    style={{ padding: "3px 7px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                  >
                    {t("Edit as JSON")}
                  </button>
                </>
              )}
            </div>
          </div>

          {rawEditMode ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <textarea
                value={rawDraft}
                onChange={(e) => { setRawDraft(e.target.value); setRawError(null); }}
                spellCheck={false}
                style={{ ...({
                  padding: "6px 9px",
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  color: "var(--text)",
                  fontSize: 12,
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box",
                } as React.CSSProperties), minHeight: 220, maxHeight: 420, fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.45, resize: "vertical", whiteSpace: "pre" }}
              />
              {rawError && (
                <div style={{ fontSize: 11, color: "#f87171", padding: "5px 8px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 4 }}>
                  {t("Invalid JSON: {error}", { error: rawError })}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => { setRawEditMode(false); setRawError(null); }}
                  style={{ padding: "4px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                >
                  {t("Cancel")}
                </button>
                <button
                  type="button"
                  onClick={applyRawDraft}
                  style={{ padding: "4px 12px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                >
                  {t("Apply raw JSON")}
                </button>
              </div>
            </div>
          ) : (
            <details>
              <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: 11 }}>{t("Raw metadata")}</summary>
              <pre style={{ margin: "6px 0 0", padding: 8, maxHeight: 280, overflow: "auto", borderRadius: 4, background: "var(--bg)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {rawJson}
              </pre>
            </details>
          )}
          <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {t("Raw metadata hint")}
          </div>
        </div>
      </div>
      {fillPickerOpen && <ModelCatalogPicker onSelect={fillFromCatalog} onClose={() => setFillPickerOpen(false)} />}
    </>
  );
}
