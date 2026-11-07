"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { AdvancedSettingEntry } from "@/lib/shared/models-config-advanced";
import styles from "./AdvancedSettingsTable.module.css";

export interface AdvancedSettingsTableProps {
  label: string;
  entries: readonly AdvancedSettingEntry[];
  onChange: (key: string, text: string) => void;
}

function AdvancedSettingValue({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  const committed = useRef(value);

  useEffect(() => {
    if (committed.current === value) return;
    committed.current = value;
    setText(value);
  }, [value]);

  const commit = () => {
    if (text === value) return;
    committed.current = text;
    onCommit(text);
  };

  return (
    <input
      className={styles.value}
      value={text}
      aria-label={label}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setText(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function AdvancedSettingsTable({ label, entries, onChange }: AdvancedSettingsTableProps) {
  const { t } = useI18n();

  return (
    <section className={styles.group} aria-label={label}>
      <h4 className={styles.label}>{label}</h4>
      {entries.length === 0 ? (
        <p className={styles.empty}>{t("No metadata")}</p>
      ) : (
        <ul className={styles.rows}>
          {entries.map((entry) => (
            <li key={entry.key} className={styles.row}>
              <code className={styles.key}>{entry.key}</code>
              <AdvancedSettingValue
                label={`${label} ${entry.key}`}
                value={entry.value}
                onCommit={(text) => onChange(entry.key, text)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
