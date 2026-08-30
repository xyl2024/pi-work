"use client";

import { useI18n } from "@/hooks/useI18n";
import { SettingsSection } from "../SettingsSection";
import { useLayoutMode, useSetLayoutMode, LAYOUT_MODES } from "@/hooks/layoutModeStore";

/**
 * Section 1: Appearance (language + layout mode). Theme switching moved
 * to the sidebar toggle — settings only holds language and the Agentic /
 * Classic layout switcher (moved here from the sidebar top). Language
 * applies immediately via the global useI18n hook; the layout mode
 * applies immediately via layoutModeStore — no `PiWorkConfig` PUT
 * involved for either.
 */
export function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();
  const layoutMode = useLayoutMode();
  const setLayoutMode = useSetLayoutMode();

  const layoutTooltip = layoutMode === "agentic"
    ? t("Agentic layout: chat in the center, file panel on the right.")
    : t("Classic layout: file panel in the center, chat on the right.");

  return (
    <SettingsSection id="appearance">
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 12px 0" }}>{t("Appearance")}</h3>

      {/* Language buttons */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0" }}>{t("Language")}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => setLocale("en")}
          style={{
            flex: 1, height: 36,
            background: locale === "en" ? "var(--accent)" : "var(--bg)",
            border: "1px solid var(--border)", borderRadius: 6,
            color: locale === "en" ? "#fff" : "var(--text)",
            cursor: "pointer", fontSize: 13, fontWeight: locale === "en" ? 600 : 500,
            transition: "background-color 0.15s, color 0.15s",
          }}
        >
          {t("English")}
        </button>
        <button
          onClick={() => setLocale("zh")}
          style={{
            flex: 1, height: 36,
            background: locale === "zh" ? "var(--accent)" : "var(--bg)",
            border: "1px solid var(--border)", borderRadius: 6,
            color: locale === "zh" ? "#fff" : "var(--text)",
            cursor: "pointer", fontSize: 13, fontWeight: locale === "zh" ? 600 : 500,
            transition: "background-color 0.15s, color 0.15s",
          }}
        >
          {t("Chinese")}
        </button>
      </div>

      {/* Layout mode buttons — Agentic / Classic. The selected mode
          applies immediately; the description below explains what the
          current layout swaps (chat vs. file panel column placement). */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "20px 0 10px 0" }}>{t("Layout mode")}</div>
      <div role="radiogroup" aria-label={t("Layout mode")} style={{ display: "flex", gap: 8 }}>
        {LAYOUT_MODES.map((option) => {
          const active = option === layoutMode;
          const label = option === "agentic" ? t("Agentic") : t("Classic");
          const ariaLabel = option === "agentic"
            ? t("Switch to Agentic layout")
            : t("Switch to Classic layout");
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={ariaLabel}
              onClick={() => setLayoutMode(option)}
              style={{
                flex: 1, height: 36,
                background: active ? "var(--accent)" : "var(--bg)",
                border: "1px solid var(--border)", borderRadius: 6,
                color: active ? "#fff" : "var(--text)",
                cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 500,
                transition: "background-color 0.15s, color 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 }}>
        {layoutTooltip}
      </div>
    </SettingsSection>
  );
}