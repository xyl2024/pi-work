"use client";

import { useI18n } from "@/hooks/useI18n";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { NumericField } from "@/components/ui/NumericField";
import { API_OPTIONS } from "./constants";
import type { ModelEntry } from "./types";
import { Field, TextInput, Check, SectionTitle, IconField, Select } from "./form-fields";
import { ThinkingLevelMapEditor } from "./ThinkingLevelMapEditor";
import { hasDeepseekCompat, setDeepseekCompat } from "./utils";
import styles from "./ModelFields.module.css";

const COST_FIELDS = ["input", "output", "cacheRead", "cacheWrite"] as const;

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
    <div className={styles.fields}>
      <div className={styles.grid}>
        <Field label={t("ID *")} error={model.id.trim() ? undefined : t("Model ID is required")}>
          <TextInput value={model.id} onChange={(v) => set("id", v)} placeholder={t("model-id")} mono />
        </Field>
        <Field label={t("Name")}><TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder={t("Display name")} /></Field>
      </div>

      <IconField value={model.icon} onChange={(v) => set("icon", v)} />

      <Field label={t("API override")}>
        <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
      </Field>

      <div className={styles.checks}>
        <Check label={t("Reasoning / thinking")} checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
        <Check label={t("Image input")} checked={model.input?.includes("image") ?? false} onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
      </div>

      {model.reasoning && (
        <>
          <Check label={t("DeepSeek thinking compat")} checked={hasDeepseekCompat(model)} onChange={(v) => onChange(setDeepseekCompat(model, v))} />
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <SectionTitle>{t("Thinking level map")}</SectionTitle>
              {model.thinkingLevelMap && (
                <button type="button" className={styles.clearButton} onClick={() => set("thinkingLevelMap", undefined)}>
                  {t("Clear all")}
                </button>
              )}
            </div>
            <ThinkingLevelMapEditor value={model.thinkingLevelMap} onChange={(v) => set("thinkingLevelMap", v)} />
          </div>
        </>
      )}

      <div className={styles.grid}>
        <Field label={t("Context window (tokens)")}>
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
        <Field label={t("Max output tokens")}>
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
        <div className={styles.gridCost}>
          {COST_FIELDS.map((k) => (
            <Field key={k} label={t(k)}>
              <NumericField
                value={model.cost?.[k] ?? null}
                onCommit={(v) => setCost(k, v)}
                min={0}
                max={1_000_000}
                step={0.01}
                integer={false}
                placeholder="0"
                ariaLabel={t(k)}
                width={92}
              />
            </Field>
          ))}
        </div>
      </div>
    </div>
  );
}
