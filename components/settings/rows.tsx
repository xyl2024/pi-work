"use client";

import { useI18n } from "@/hooks/useI18n";
import { NumericField } from "@/components/ui/NumericField";

/** Numeric file-preview limit with delayed validation and immediate-apply commit. */
export function FileViewerLimitRow({
  label,
  min,
  max,
  value,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onCommit: (next: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ marginBottom: 12 }}>
      <NumericField
        label={label}
        value={value}
        onCommit={(next) => { if (next !== null) onCommit(next); }}
        min={min}
        max={max}
        unit="MB"
        hint={t("Range: {min}–{max} MB", { min, max })}
        emptyHint={t("Value must not be empty")}
        rangeError={t("Must be between {min} and {max}", { min, max })}
        ariaLabel={label}
      />
    </div>
  );
}

/** Retry setting with optional empty value meaning “use SDK default”. */
export function RetryNumberRow({
  label,
  min,
  max,
  value,
  placeholder,
  optional,
  unitSuffix,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  value: number | null;
  placeholder: string;
  optional: boolean;
  unitSuffix?: string;
  onCommit: (next: number | null) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ marginBottom: 12 }}>
      <NumericField
        label={label}
        value={value}
        onCommit={onCommit}
        min={min}
        max={max}
        placeholder={placeholder}
        unit={unitSuffix}
        optional={optional}
        emptyHint={t("Value must not be empty")}
        rangeError={t("Must be between {min} and {max}", { min, max })}
        hint={optional
          ? t("Range: {min}–{max} (empty = use SDK default)", { min, max })
          : t("Range: {min}–{max}", { min, max })}
        ariaLabel={label}
      />
    </div>
  );
}
