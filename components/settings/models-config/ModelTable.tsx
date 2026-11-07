"use client";

import type { KeyboardEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  UNKNOWN_MODEL_VALUE,
  modelTableRow,
  type ModelTableModel,
} from "@/lib/shared/models-config-table";
import styles from "./ModelTable.module.css";

export interface ModelTableItem {
  key: string;
  model: ModelTableModel;
  onOpen?: () => void;
}

export interface ModelTableProps {
  items: readonly ModelTableItem[];
  onSelect?: (item: ModelTableItem) => void;
  label?: string;
}

function unknownClass(value: string): string {
  return value === UNKNOWN_MODEL_VALUE ? ` ${styles.unknown}` : "";
}

export function ModelTableRow({
  model,
  onOpen,
}: {
  model: ModelTableModel;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const row = modelTableRow(model);
  const activate = onOpen
    ? {
        tabIndex: 0,
        "data-clickable": "true",
        onClick: onOpen,
        onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onOpen();
        },
      }
    : {};

  return (
    <tr className={styles.row} {...activate}>
      <td className={styles.cell}>
        <span className={styles.name}>{row.title || t("new model")}</span>
        {row.subtitle && <span className={styles.id}>{row.subtitle}</span>}
      </td>
      <td className={styles.cell}>
        {row.capabilities.length > 0 && (
          <span className={styles.tags}>
            {row.capabilities.map((capability) => (
              <span key={capability} className={styles.tag}>{t(capability)}</span>
            ))}
          </span>
        )}
      </td>
      <td className={`${styles.cell} ${styles.numeric}${unknownClass(row.context)}`}>{row.context}</td>
      <td className={`${styles.cell} ${styles.numeric}${unknownClass(row.inputPrice)}`}>{row.inputPrice}</td>
      <td className={`${styles.cell} ${styles.numeric}${unknownClass(row.outputPrice)}`}>{row.outputPrice}</td>
    </tr>
  );
}

export function ModelTable({ items, onSelect, label }: ModelTableProps) {
  const { t } = useI18n();
  return (
    <table className={styles.table} aria-label={label}>
      <thead>
        <tr>
          <th scope="col" className={styles.headCell}>{t("Model")}</th>
          <th scope="col" className={styles.headCell}>
            <span className={styles.srOnly}>{t("Capabilities")}</span>
          </th>
          <th scope="col" className={`${styles.headCell} ${styles.numeric}`}>{t("Context")}</th>
          <th scope="col" className={`${styles.headCell} ${styles.numeric}`}>
            {t("Input")}<span className={styles.unit}>$/M</span>
          </th>
          <th scope="col" className={`${styles.headCell} ${styles.numeric}`}>
            {t("Output")}<span className={styles.unit}>$/M</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <ModelTableRow
            key={item.key}
            model={item.model}
            onOpen={item.onOpen ?? (onSelect ? () => onSelect(item) : undefined)}
          />
        ))}
      </tbody>
    </table>
  );
}
