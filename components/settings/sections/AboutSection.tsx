"use client";

import { useI18n } from "@/hooks/useI18n";
import { SettingsGroup, SettingsRow } from "../rows";

const GITHUB_URL = "https://github.com/xyl2024/pi-work";

export function AboutSection() {
  const { t } = useI18n();
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";
  const piVersion = process.env.NEXT_PUBLIC_PI_VERSION ?? "unknown";

  return (
    <>
      <SettingsGroup>
        <SettingsRow title={t("Pi Work version")}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
            v{appVersion}
          </span>
        </SettingsRow>
        <SettingsRow title={t("Pi version")}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
            v{piVersion}
          </span>
        </SettingsRow>
        <SettingsRow
          title={t("GitHub repository")}
          description={t("View source code and report issues on GitHub.")}
        >
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)", fontSize: 12, textDecoration: "none" }}
          >
            {GITHUB_URL.replace("https://", "")}
          </a>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
