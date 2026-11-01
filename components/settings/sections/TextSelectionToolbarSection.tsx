"use client";

import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import type { PiWorkConfig } from "@/lib/shared/config-types";

export function TextSelectionToolbarSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const enabled = config.text_selection_toolbar.enabled;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 13, color: "var(--text)" }}>
        {enabled ? t("Selection toolbar on") : t("Selection toolbar off")}
      </span>
      <ToggleSwitch
        on={enabled}
        onChange={(next) => {
          void apply((prev) => ({
            ...prev,
            text_selection_toolbar: { enabled: next },
          }));
        }}
        label={t("Text selection toolbar")}
      />
    </div>
  );
}
