"use client";

import { useI18n } from "@/hooks/useI18n";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { NumericField } from "@/components/ui/NumericField";
import { API_OPTIONS } from "./constants";
import type { ModelEntry } from "./types";
import { Field, TextInput, Check, IconField, Select } from "./form-fields";
import { ThinkingLevelMapEditor } from "./ThinkingLevelMapEditor";
import { hasDeepseekCompat, setDeepseekCompat } from "./utils";
import { FormSection } from "./FormSection";
import { AdvancedSettings } from "./AdvancedSettings";
import { COST_FIELDS, costTierRows, formatThousands } from "@/lib/shared/models-config-cost";
import { formatModelPrice } from "@/lib/shared/models-config-table";
import styles from "./ModelFields.module.css";

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
  const tokensHint = (value: number | undefined) => {
    const formatted = formatThousands(value);
    return formatted ? t("{value} tokens", { value: formatted }) : undefined;
  };
  const tierRows = costTierRows(model.cost?.tiers);

  return (
    <div className={styles.form}>
      <FormSection title={t("Basics")}>
        <div className={styles.twoColumns}>
          <Field label={t("ID *")} error={model.id.trim() ? undefined : t("Model ID is required")}>
            <TextInput value={model.id} onChange={(v) => set("id", v)} placeholder={t("model-id")} mono />
          </Field>
          <Field label={t("Name")}>
            <TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder={t("Display name")} />
          </Field>
        </div>
        <IconField value={model.icon} onChange={(v) => set("icon", v)} />
        <Field label={t("API override")}>
          <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
        </Field>
      </FormSection>

      <FormSection title={t("Capabilities")}>
        <div className={styles.checks}>
          <Check label={t("Reasoning / thinking")} checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
          <Check label={t("Image input")} checked={model.input?.includes("image") ?? false} onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
        </div>
        {model.reasoning && (
          <div className={styles.reasoning}>
            <Check label={t("DeepSeek thinking compat")} checked={hasDeepseekCompat(model)} onChange={(v) => onChange(setDeepseekCompat(model, v))} />
            <div className={styles.mapBlock}>
              <div className={styles.mapHeader}>
                <span className={styles.subLabel}>{t("Thinking level map")}</span>
                {model.thinkingLevelMap && (
                  <button type="button" className={styles.textButton} onClick={() => set("thinkingLevelMap", undefined)}>
                    {t("Clear all")}
                  </button>
                )}
              </div>
              <ThinkingLevelMapEditor value={model.thinkingLevelMap} onChange={(v) => set("thinkingLevelMap", v)} />
            </div>
          </div>
        )}
      </FormSection>

      <FormSection title={t("Specs")}>
        <div className={styles.twoColumns}>
          <Field label={t("Context window (tokens)")} hint={tokensHint(model.contextWindow)}>
            <NumberStepper
              value={model.contextWindow ?? NaN}
              onChange={(v) => set("contextWindow", Number.isInteger(v) ? v : undefined)}
              min={1}
              max={10_000_000}
              ariaLabel={t("Context window (tokens)")}
              placeholder="128000"
              width={120}
            />
          </Field>
          <Field label={t("Max output tokens")} hint={tokensHint(model.maxTokens)}>
            <NumberStepper
              value={model.maxTokens ?? NaN}
              onChange={(v) => set("maxTokens", Number.isInteger(v) ? v : undefined)}
              min={1}
              max={10_000_000}
              ariaLabel={t("Max output tokens")}
              placeholder="16384"
              width={120}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={t("Cost ($ per million tokens)")}>
        <div className={styles.costGrid}>
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
                width={96}
              />
            </Field>
          ))}
        </div>
        {tierRows.length > 0 && (
          <div className={styles.tiers}>
            <div className={styles.tiersHeader}>
              <span className={styles.subLabel}>{t("Cost tiers")}</span>
              <span className={styles.hint}>{t("Edit tiers in raw JSON")}</span>
            </div>
            <div className={styles.tierGrid}>
              <span className={styles.tierColumnLabel} />
              <span className={styles.tierColumnLabel}>{t("Input")}</span>
              <span className={styles.tierColumnLabel}>{t("Output")}</span>
              <span className={styles.tierColumnLabel}>{t("Cache read")}</span>
              <span className={styles.tierColumnLabel}>{t("Cache write")}</span>
              {tierRows.map((row) => (
                <div key={row.tokensAbove} className={styles.tierRow}>
                  <span className={styles.tierThreshold}>
                    {t("Above {tokens} tokens", { tokens: formatThousands(row.tokensAbove) })}
                  </span>
                  <span className={styles.tierPrice}>{formatModelPrice(row.input)}</span>
                  <span className={styles.tierPrice}>{formatModelPrice(row.output)}</span>
                  <span className={styles.tierPrice}>{formatModelPrice(row.cacheRead)}</span>
                  <span className={styles.tierPrice}>{formatModelPrice(row.cacheWrite)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </FormSection>

      <AdvancedSettings
        title={t("Advanced")}
        groups={[
          { key: "compat", label: "compat", value: model.compat, onChange: (v) => set("compat", v) },
          { key: "promptCache", label: "promptCache", value: model.promptCache as Record<string, unknown> | undefined, onChange: (v) => set("promptCache", v as ModelEntry["promptCache"]) },
          { key: "inputLimits", label: "inputLimits", value: model.inputLimits as Record<string, unknown> | undefined, onChange: (v) => set("inputLimits", v as ModelEntry["inputLimits"]) },
          { key: "samplingParams", label: "samplingParams", value: model.samplingParams, onChange: (v) => set("samplingParams", v) },
        ]}
      />
    </div>
  );
}
