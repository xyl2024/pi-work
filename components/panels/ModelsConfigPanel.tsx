"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * Tracer-bullet body for the 模型配置 panel view.
 *
 * The provider list, the two-level navigation and the save bar all arrive in
 * later slices of the panel migration; this slice only proves the entry
 * points (right-bar button, tab strip, command palette) wire up to the same
 * panel. Until then the body is an intentionally empty placeholder.
 */
export function ModelsConfigPanel() {
  const { t } = useI18n();
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-dim)",
        fontSize: 12,
      }}
    >
      {t("Models config")}
    </div>
  );
}
