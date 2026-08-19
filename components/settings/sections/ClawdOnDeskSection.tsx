"use client";

import type { Dispatch, SetStateAction } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { PiWorkConfig } from "@/lib/config";

/**
 * Section 4: Clawd on Desk.
 *
 * Note: this section deliberately still uses the modal-wide Save
 * button (the parent owns `isDirty` based on the JSON-snapshot
 * comparison). All other "immediate-apply" sections skip the Save
 * step and PUT on toggle. We are leaving that asymmetry in place —
 * the user has indicated the clawd plugin will be removed in a
 * follow-up, so the inconsistency will go away on its own.
 */
export function ClawdOnDeskSection({
  config,
  setConfig,
  canSave,
  saving,
  savedOk,
  onSave,
}: {
  config: PiWorkConfig;
  setConfig: Dispatch<SetStateAction<PiWorkConfig | null>>;
  canSave: boolean;
  saving: boolean;
  savedOk: boolean;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const clawdOnDeskEnabled = config.extensions.clawd_on_desk.enabled;

  return (
    <div data-settings-section="settings-section-clawd" style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>{t("Clawd on Desk")}</h3>
        <button
          onClick={onSave}
          disabled={!canSave || saving || savedOk}
          style={{
            padding: "4px 14px", height: 28,
            background: savedOk ? "#16a34a" : saving ? "var(--bg-panel)" : "var(--accent)",
            border: "none", borderRadius: 6,
            color: savedOk ? "#fff" : saving ? "var(--text-muted)" : "#fff",
            cursor: (!canSave || saving || savedOk) ? "default" : "pointer",
            fontSize: 12, fontWeight: 600,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "background-color 0.2s ease, color 0.2s ease",
          }}
        >
          {savedOk && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          <span>{savedOk ? t("Saved") : saving ? t("Saving...") : t("Save")}</span>
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.5 }}>
        {t("Stream session events to a local Clawd desktop server (127.0.0.1:23333-23337). Useful for driving a desktop agent UI. Changes take effect on new sessions.")}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>{t("Enable Clawd on Desk")}</span>
        <button
          onClick={() =>
            setConfig((prev) => {
              // The section is only mounted while config is loaded, so
              // prev should always be non-null here. Bail out otherwise
              // to keep TypeScript happy and avoid corrupting state.
              if (!prev) return prev;
              return {
                ...prev,
                extensions: {
                  ...prev.extensions,
                  clawd_on_desk: { enabled: !prev.extensions.clawd_on_desk.enabled },
                },
              };
            })
          }
          style={{
            width: 40, height: 22, borderRadius: 11,
            background: clawdOnDeskEnabled ? "var(--accent)" : "var(--bg-hover)",
            border: "none", cursor: "pointer", position: "relative",
            transition: "background 0.2s",
          }}
        >
          <span style={{
            position: "absolute", top: 2, left: clawdOnDeskEnabled ? 20 : 2,
            width: 18, height: 18, borderRadius: 9,
            background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            transition: "left 0.2s",
          }} />
        </button>
      </div>
    </div>
  );
}