"use client";

import { useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";
import { API_OPTIONS } from "./constants";
import type { ProviderEntry } from "./types";
import { Field, TextInput, SecretTextInput, Select, IconField } from "./form-fields";
import styles from "./ProviderFields.module.css";

export function ProviderFields({
  name,
  provider,
  onChange,
  onRename,
}: {
  name: string;
  provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void;
  onRename: (n: string) => void;
}) {
  const { t } = useI18n();
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) =>
    onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api]);

  return (
    <div className={styles.fields}>
      <Field label={t("Provider name")}>
        <TextInput value={name} onChange={onRename} placeholder={t("provider-name")} mono />
      </Field>

      <IconField value={provider.icon} onChange={(v) => set("icon", v)} />

      <Field label={t("Base URL")}>
        <TextInput
          value={provider.baseUrl ?? ""}
          onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="https://api.example.com/v1"
          mono
        />
      </Field>

      <Field label={t("API Key")} hint={t("Prefix with ! to run a shell command, or use an env var name")}>
        <SecretTextInput
          value={provider.apiKey ?? ""}
          onChange={(v) => set("apiKey", v || undefined)}
          placeholder={t("ENV_VAR_NAME, !shell-command, or literal key")}
          mono
        />
      </Field>

      <Field label={t("API")}>
        <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
      </Field>
    </div>
  );
}
