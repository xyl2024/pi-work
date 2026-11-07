"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  advancedSettingRows,
  parseAdvancedSettingInput,
  setAdvancedSetting,
  type AdvancedSettingRow,
  type AdvancedSettingValue,
} from "@/lib/shared/models-config-advanced";
import styles from "./AdvancedSettings.module.css";

export interface AdvancedSettingsGroup {
  key: string;
  label: string;
  value: Record<string, unknown> | undefined;
  onChange: (next: Record<string, unknown> | undefined) => void;
}

export interface AdvancedSettingsProps {
  title: string;
  groups: readonly AdvancedSettingsGroup[];
  emptyLabel?: string;
}

function displayValue(row: AdvancedSettingRow): string {
  return row.kind === "json" ? JSON.stringify(row.value) : String(row.value);
}

function SettingValueEditor({
  row,
  onCommit,
}: {
  row: AdvancedSettingRow;
  onCommit: (value: AdvancedSettingValue | undefined) => void;
}) {
  const { t } = useI18n();
  const rendered = displayValue(row);
  const [draft, setDraft] = useState(rendered);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(rendered);
    setInvalid(false);
  }, [rendered]);

  const commit = (text: string) => {
    const parsed = parseAdvancedSettingInput(text, row.kind);
    if (!parsed.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed.value !== row.value) onCommit(parsed.value);
  };

  if (row.kind === "boolean") {
    return (
      <select
        className={styles.control}
        value={String(row.value)}
        aria-label={row.path}
        onChange={(event) => onCommit(event.target.value === "true")}
      >
        <option value="true">{t("Yes")}</option>
        <option value="false">{t("No")}</option>
      </select>
    );
  }

  return (
    <input
      className={styles.control}
      data-invalid={invalid ? "true" : undefined}
      aria-label={row.path}
      aria-invalid={invalid || undefined}
      value={draft}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(draft);
        } else if (event.key === "Escape") {
          setDraft(rendered);
          setInvalid(false);
        }
      }}
    />
  );
}

export function AdvancedSettings({ title, groups, emptyLabel }: AdvancedSettingsProps) {
  const { t } = useI18n();
  const sections = groups
    .map((group) => ({ group, rows: advancedSettingRows(group.value, "") }))
    .filter((section) => section.rows.length > 0);
  const total = sections.reduce((count, section) => count + section.rows.length, 0);

  return (
    <details className={styles.panel}>
      <summary className={styles.summary}>
        <span className={styles.title}>{title}</span>
        {total > 0 && <span className={styles.count}>{total}</span>}
      </summary>
      {sections.length === 0 ? (
        <p className={styles.empty}>{emptyLabel ?? t("No advanced settings set.")}</p>
      ) : (
        <div className={styles.body}>
          {sections.map(({ group, rows }) => (
            <div key={group.key} className={styles.group}>
              <div className={styles.groupLabel}>{group.label}</div>
              <div className={styles.rows}>
                {rows.map((row) => (
                  <div key={row.path} className={styles.row}>
                    <span className={styles.path} title={row.path}>{row.path}</span>
                    <SettingValueEditor
                      row={row}
                      onCommit={(value) => group.onChange(setAdvancedSetting(group.value, row.path, value))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
