"use client";

import { useI18n } from "@/hooks/useI18n";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { NumericField } from "@/components/ui/NumericField";
import { API_OPTIONS } from "./constants";
import type { ModelEntry } from "./types";
import { Field, TextInput, Check, SectionTitle, IconField, Select } from "./form-fields";
import { ThinkingLevelMapEditor } from "./ThinkingLevelMapEditor";
import { hasDeepseekCompat, setDeepseekCompat } from "./utils";

/**
 * The editable model fields — id, display name, icon, API override, reasoning /
 * image flags, the DeepSeek compat toggle, the thinking-level map, the context
 * and output limits and the four cost columns.
 *
 * It carries no header actions and no raw-JSON view: the modal's `ModelDetail`
 * and the panel's model page each wrap it with the actions that fit their
 * surface, the same way `ProviderFields` is shared.
 */
export function ModelFields({
  model,
  onChange,
}: {
  model: ModelEntry;
  onChange: (model: ModelEntry) => void;
}) {
  const { t } = useI18n();
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const setCost = (k: keyof NonNullable<ModelEntry["cost"]>, v: number | null) => {
    onChange({ ...model, cost: { ...(model.cost ?? {}), [k]: v ?? undefined } });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
          <NumberStepper
            value={model.contextWindow ?? NaN}
            onChange={(v) => set("contextWindow", Number.isInteger(v) ? v : undefined)}
            min={1}
            max={10_000_000}
            ariaLabel={t("Context window (tokens)")}
            placeholder="128000"
            width={92}
          />
        </Field>
        <Field label="Max output tokens">
          <NumberStepper
            value={model.maxTokens ?? NaN}
            onChange={(v) => set("maxTokens", Number.isInteger(v) ? v : undefined)}
            min={1}
            max={10_000_000}
            ariaLabel={t("Max output tokens")}
            placeholder="16384"
            width={92}
          />
        </Field>
      </div>

      <div>
        <SectionTitle>{t("Cost (per million tokens)")}</SectionTitle>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
            <Field key={k} label={k}>
              <NumericField
                value={model.cost?.[k] ?? null}
                onCommit={(v) => setCost(k, v)}
                min={0}
                max={1_000_000}
                step={0.01}
                integer={false}
                placeholder="0"
                ariaLabel={k}
                width={92}
              />
            </Field>
          ))}
        </div>
      </div>
    </div>
  );
}
