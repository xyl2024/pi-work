"use client";

import { useI18n } from "@/hooks/useI18n";

export interface PanelBackSource {
  useSnapshot(): { pages: readonly unknown[] };
  back(): { closePanel: boolean };
}

export function PanelBackButton({
  panel,
  labelKey = "Back",
  ariaLabelKey = "Back",
}: {
  panel: PanelBackSource;
  labelKey?: string;
  ariaLabelKey?: string;
}) {
  const { t } = useI18n();
  const { pages } = panel.useSnapshot();
  const enabled = pages.length > 1;
  return (
    <button
      type="button"
      onClick={() => {
        panel.back();
      }}
      disabled={!enabled}
      aria-label={t(ariaLabelKey)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 9px",
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: 5,
        color: "var(--text-muted)",
        cursor: enabled ? "pointer" : "default",
        fontSize: 12,
        flexShrink: 0,
        fontFamily: "inherit",
        opacity: enabled ? 1 : 0.5,
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="15 6 9 12 15 18" />
      </svg>
      {t(labelKey)}
    </button>
  );
}
