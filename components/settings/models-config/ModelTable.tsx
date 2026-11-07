"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
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
  activeKey?: string | null;
  onHoverItem?: (item: ModelTableItem) => void;
}

function unknownClass(value: string): string {
  return value === UNKNOWN_MODEL_VALUE ? ` ${styles.unknown}` : "";
}

export function ModelTableRow({
  model,
  onOpen,
  active = false,
  onHover,
  rowRef,
}: {
  model: ModelTableModel;
  onOpen?: () => void;
  active?: boolean;
  onHover?: () => void;
  rowRef?: (element: HTMLTableRowElement | null) => void;
}) {
  const { t } = useI18n();
  const row = modelTableRow(model);

  return (
    <tr
      ref={rowRef}
      className={styles.row}
      data-active={active ? "true" : undefined}
      data-clickable={onOpen ? "true" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onMouseEnter={onHover}
      onClick={onOpen}
      onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
        if (!onOpen || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen();
      }}
    >
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

export function ModelTable({ items, onSelect, label, activeKey = null, onHoverItem }: ModelTableProps) {
  const { t } = useI18n();
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  useEffect(() => {
    if (activeKey) rowRefs.current.get(activeKey)?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

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
            active={item.key === activeKey}
            rowRef={(element) => {
              if (element) rowRefs.current.set(item.key, element);
              else rowRefs.current.delete(item.key);
            }}
            onHover={onHoverItem ? () => onHoverItem(item) : undefined}
            onOpen={item.onOpen ?? (onSelect ? () => onSelect(item) : undefined)}
          />
        ))}
      </tbody>
    </table>
  );
}
