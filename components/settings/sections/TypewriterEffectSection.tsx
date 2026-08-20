"use client";

import { useI18n } from "@/hooks/useI18n";
import type { PiWorkConfig } from "@/lib/shared/config-types";

/**
 * Section 9: Typewriter effect master toggle.
 *
 * Independent immediate-apply switch, same shape as the
 * APPEND_SYSTEM.md loader toggle in Section 3. Flipping the switch
 * publishes to the settings store synchronously so the chat input
 * renders with the new behavior on its next render (no reload, no
 * per-session activation — the input reads the flag from the store
 * on every placeholder render).
 */
export function TypewriterEffectSection({
  config,
  apply,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const enabled = config.typewriter_effect.enabled;

  return (
    <div data-settings-section="settings-section-typewriter-effect" style={{ marginBottom: 24, marginTop: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
        {t("Typewriter effect")}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
        {t("Show cycling animated phrases in the empty chat input. Turn off to show a static placeholder instead.")}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>
          {enabled ? t("Effect on") : t("Effect off")}
        </span>
        <button
          onClick={() => {
            void apply((prev) => ({
              ...prev,
              typewriter_effect: { enabled: !prev.typewriter_effect.enabled },
            }));
          }}
          aria-label={t("Typewriter effect")}
          style={{
            width: 40, height: 22, borderRadius: 11,
            background: enabled ? "var(--accent)" : "var(--bg-hover)",
            border: "none", cursor: "pointer", position: "relative",
            transition: "background 0.2s",
          }}
        >
          <span style={{
            position: "absolute", top: 2,
            left: enabled ? 20 : 2,
            width: 18, height: 18, borderRadius: 9,
            background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            transition: "left 0.2s",
          }} />
        </button>
      </div>
    </div>
  );
}