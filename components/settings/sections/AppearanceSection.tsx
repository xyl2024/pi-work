"use client";

import { useI18n } from "@/hooks/useI18n";
import { SettingsSection } from "../SettingsSection";
import { SegmentedControl } from "../controls";
import { useLayoutMode, useSetLayoutMode, LAYOUT_MODES } from "@/hooks/layoutModeStore";

/**
 * Section: Appearance (language + layout mode). Theme switching moved
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

      {/* Language */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0" }}>{t("Language")}</div>
      <SegmentedControl
        value={locale}
        onChange={(value) => setLocale(value as "en" | "zh")}
        ariaLabel={t("Language")}
        options={[
          { value: "en", label: t("English") },
          { value: "zh", label: t("Chinese") },
        ]}
      />

      {/* Layout mode buttons — Agentic / Classic. The selected mode
          applies immediately; the description below explains what the
          current layout swaps (chat vs. file panel column placement). */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "20px 0 10px 0" }}>{t("Layout mode")}</div>
      <SegmentedControl
        value={layoutMode}
        onChange={(value) => setLayoutMode(value as typeof LAYOUT_MODES[number])}
        ariaLabel={t("Layout mode")}
        options={LAYOUT_MODES.map((option) => ({
          value: option,
          label: option === "agentic" ? t("Agentic") : t("Classic"),
          title: option === "agentic" ? t("Switch to Agentic layout") : t("Switch to Classic layout"),
        }))}
      />
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 }}>
        {layoutTooltip}
      </div>
    </SettingsSection>
  );
}