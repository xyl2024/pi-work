"use client";

import { useI18n } from "@/hooks/useI18n";
import { useTheme, type ThemePreset } from "@/hooks/useTheme";
import { ICONS } from "@/components/ui/icons";
import { SegmentedControl } from "../controls";
import { SettingsGroup, SettingsRow } from "../rows";
import styles from "./AppearanceSection.module.css";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: ICONS.sun },
  { value: "dark", label: "Dark", icon: ICONS.moon },
] as const;

const LOCALE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
] as const;

export function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();
  const { preset, setPreset } = useTheme();

  return (
    <>
      <SettingsGroup title={t("Theme")}>
        <div className={styles.cards} role="radiogroup" aria-label={t("Theme")}>
          {THEME_OPTIONS.map((option) => {
            const active = option.value === preset;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={(event) => setPreset(option.value as ThemePreset, { x: event.clientX, y: event.clientY })}
                className={[styles.card, active ? styles.cardActive : ""].filter(Boolean).join(" ")}
              >
                <span className={styles.cardIcon}>
                  <Icon size={18} />
                </span>
                {t(option.label)}
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("Language")}>
        <SettingsRow
          title={t("Language")}
          description={t("Language of the interface.")}
        >
          <SegmentedControl
            value={locale}
            onChange={(next) => setLocale(next as typeof locale)}
            options={LOCALE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.label),
            }))}
            ariaLabel={t("Language")}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
