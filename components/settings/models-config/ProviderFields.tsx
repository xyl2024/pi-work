"use client";

import { useI18n } from "@/hooks/useI18n";
import { API_OPTIONS } from "./constants";
import type { ProviderEntry } from "./types";
import { Field, TextInput, SecretTextInput, Select, IconField } from "./form-fields";
import { FormSection } from "./FormSection";
import styles from "./ProviderFields.module.css";

export function ProviderFields({
  name,
  provider,
  onChange,
  onRename,
  nameError,
}: {
  name: string;
  provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void;
  onRename: (n: string) => void;
  nameError?: string;
}) {
  const { t } = useI18n();
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) =>
    onChange({ ...provider, [k]: v });

  return (
    <div className={styles.fields}>
      <FormSection title={t("Basics")}>
        <Field label={t("Provider name")} error={nameError}>
          <TextInput value={name} onChange={onRename} placeholder={t("provider-name")} mono invalid={!!nameError} />
        </Field>
        <IconField value={provider.icon} onChange={(v) => set("icon", v)} />
      </FormSection>

      <FormSection title={t("Connection")}>
        <Field label={t("API")}>
          <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
        </Field>
        <Field label={t("Base URL")}>
          <TextInput
            value={provider.baseUrl ?? ""}
            onChange={(v) => set("baseUrl", v || undefined)}
            placeholder="https://api.example.com/v1"
            mono
          />
        </Field>
        <Field label={t("API Key")} hint={t("Literal value, $ENV_VAR, or !shell-command.")}>
          <SecretTextInput
            value={provider.apiKey ?? ""}
            onChange={(v) => set("apiKey", v || undefined)}
            placeholder={t("ENV_VAR_NAME, !shell-command, or literal key")}
            mono
          />
        </Field>
      </FormSection>
    </div>
  );
}
