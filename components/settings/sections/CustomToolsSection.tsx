"use client";

import { useI18n } from "@/hooks/useI18n";
import { CUSTOM_TOOLS_UI } from "../constants";
import type { PiWorkConfig } from "@/lib/shared/config-types";

/**
 * Section 5: Custom Tools (agent_todo, show_media, ask_user_questions).
 * Immediate-apply checkboxes — same shape as the Right-side buttons
 * section. Toggling only affects sessions started AFTER the PUT
 * (createAgentSession freezes customTools).
 */
export function CustomToolsSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();

  return (
    <div data-settings-section="settings-section-custom-tools" style={{ marginBottom: 24, marginTop: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
        {t("Custom Tools")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
        {t("Enable or disable custom pi tools. Changes apply to sessions started after this point; running sessions keep their original tool set.")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {CUSTOM_TOOLS_UI.map(({ id, labelKey }) => {
          const checked = config.custom_tools.enabled.includes(id);
          return (
            <label
              key={id}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)" }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  void apply((prev) => {
                    const isEnabled = prev.custom_tools.enabled.includes(id);
                    const nextEnabled = isEnabled
                      ? prev.custom_tools.enabled.filter((name) => name !== id)
                      : [...prev.custom_tools.enabled, id];
                    return { ...prev, custom_tools: { enabled: nextEnabled } };
                  });
                }}
                style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }}
              />
              <span>{t(labelKey)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}