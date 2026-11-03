"use client";

import { useI18n } from "@/hooks/useI18n";
import { useTheme, type ThemePreset } from "@/hooks/useTheme";
import { SectionTitle, SegmentedControl } from "../controls";

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const LOCALE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
] as const;

export function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();
  const { preset, setPreset } = useTheme();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 360 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionTitle>{t("Theme")}</SectionTitle>
        <SegmentedControl
          value={preset}
          onChange={(next) => setPreset(next as ThemePreset)}
          options={THEME_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.label),
          }))}
          ariaLabel={t("Theme")}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionTitle>{t("Language")}</SectionTitle>
        <SegmentedControl
          value={locale}
          onChange={(next) => setLocale(next as typeof locale)}
          options={LOCALE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.label),
          }))}
          ariaLabel={t("Language")}
        />
      </div>
    </div>
  );
}
