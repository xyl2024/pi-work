"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * Section 1: Appearance (language). Theme switching moved to the sidebar
 * toggle — settings only holds language so the two affordances don't
 * duplicate each other. The language selector applies immediately via
 * the global useI18n hook — no `PiWorkConfig` PUT is involved.
 */
export function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();

  return (
    <div data-settings-section="settings-section-appearance" style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 12px 0" }}>{t("Appearance")}</h3>

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