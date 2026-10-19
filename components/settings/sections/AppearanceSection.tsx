"use client";

import { useI18n } from "@/hooks/useI18n";
import { SettingsSection } from "../SettingsSection";
import { SegmentedControl } from "../controls";
import { useLayoutMode, useSetLayoutMode, LAYOUT_MODES } from "@/hooks/layoutModeStore";

/**
 * Section: Appearance (layout mode). Language and theme switching live
 * in the sidebar footer. Layout mode applies immediately via
 * layoutModeStore — no `PiWorkConfig` PUT involved.
 */
export function AppearanceSection() {
  const { t } = useI18n();
  const layoutMode = useLayoutMode();
  const setLayoutMode = useSetLayoutMode();

  const layoutTooltip = layoutMode === "agentic"
    ? t("Agentic layout: chat in the center, file panel on the right.")
    : t("Classic layout: file panel in the center, chat on the right.");

  return (
    <SettingsSection id="appearance">
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 12px 0" }}>{t("Appearance")}</h3>

      {/* Layout mode buttons — Agentic / Classic. The selected mode
          applies immediately; the description below explains what the
          current layout swaps (chat vs. file panel column placement). */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0" }}>{t("Layout mode")}</div>
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