"use client";

import type { MouseEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme, PRESETS, PRESET_LABELS } from "@/hooks/useTheme";

/**
 * Section 1: Appearance (theme + language). Both selectors apply
 * immediately via the existing global hooks (useTheme / useI18n) — no
 * `PiWorkConfig` PUT is involved. The `setPreset` call accepts the
 * click coords so the theme transition can radiate from the clicked
 * swatch.
 */
export function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();
  const { preset, setPreset } = useTheme();

  return (
    <div data-settings-section="settings-section-appearance" style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 12px 0" }}>{t("Appearance")}</h3>

      {/* Theme swatches */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0" }}>{t("Theme")}</div>
      <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setPreset(p, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6,
              padding: 0, background: "none", border: "none", cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 100, height: 60, borderRadius: 8,
                border: preset === p ? "2px solid var(--accent)" : "2px solid var(--border)",
                background: p === "default"
                  ? "linear-gradient(135deg, #fafafa 50%, #6366f1 50%)"
                  : p === "midnight"
                  ? "linear-gradient(135deg, #0f172a 50%, #818cf8 50%)"
                  : p === "synthwave"
                  ? "linear-gradient(135deg, #1e1b4b 50%, #f472b6 50%)"
                  : p === "forest"
                  ? "linear-gradient(135deg, #f0fdf4 50%, #16a34a 50%)"
                  : "linear-gradient(135deg, #fdf6e3 50%, #b45309 50%)",
                transition: "border-color 0.15s",
              }}
            />
            <div style={{
              fontSize: 11, textAlign: "center",
              color: preset === p ? "var(--accent)" : "var(--text-muted)",
              fontWeight: preset === p ? 600 : 400,
            }}>
              {PRESET_LABELS[p][locale]}
            </div>
          </button>
        ))}
      </div>

      {/* Language buttons */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0" }}>{t("Language")}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => setLocale("en")}
          style={{
            flex: 1, height: 36,
            background: locale === "en" ? "var(--accent)" : "var(--bg-panel)",
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
            background: locale === "zh" ? "var(--accent)" : "var(--bg-panel)",
            border: "1px solid var(--border)", borderRadius: 6,
            color: locale === "zh" ? "#fff" : "var(--text)",
            cursor: "pointer", fontSize: 13, fontWeight: locale === "zh" ? 600 : 500,
            transition: "background-color 0.15s, color 0.15s",
          }}
        >
          {t("Chinese")}
        </button>
      </div>
    </div>
  );
}