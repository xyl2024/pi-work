"use client";

import { useI18n } from "@/hooks/useI18n";

const GITHUB_URL = "https://github.com/xyl2024/pi-work";

export function AboutSection() {
  const { t } = useI18n();
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";
  const piVersion = process.env.NEXT_PUBLIC_PI_VERSION ?? "unknown";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 560 }}>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
        {t("View source code and report issues on GitHub.")}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(140px, 0.35fr) 1fr",
          gap: "10px 16px",
          padding: 14,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg)",
        }}
      >
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("Pi Work version")}</span>
        <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13 }}>v{appVersion}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("Pi version")}</span>
        <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13 }}>v{piVersion}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("GitHub repository")}</span>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--accent)", fontSize: 13, textDecoration: "none" }}
        >
          {GITHUB_URL}
        </a>
      </div>
    </div>
  );
}
