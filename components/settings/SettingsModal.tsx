"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { setSettings, useSettings } from "@/hooks/settingsStore";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { UNSAVED_CHANGES_CONFIRM_KEY, selectIsDirty, selectSectionLeave } from "@/lib/shared/settings-unsaved";
import {
  DEFAULT_SETTINGS_SECTION_ID,
  SETTINGS_GROUPS,
  sectionsForGroup,
  type SettingsSectionId,
} from "./registry";
import { readLastSettingsSection, writeLastSettingsSection } from "@/lib/client/last-settings-section";
import { createSettingsPageCache } from "@/lib/client/settings-page-cache";
import { useSettingsWrite } from "./use-settings-write";
import { useUnsavedChanges, type DirtyReporter } from "./use-unsaved-changes";
import { SETTINGS_PAGES } from "./pages";
import { SettingsSection } from "./SettingsSection";

const MODAL_WIDTH = "min(960px, calc(100vw - 32px))";

export function SettingsModal({
  onClose,
  onProfileSaved,
}: {
  onClose: () => void;
  onProfileSaved?: () => void;
}) {
  const { t } = useI18n();
  const config = useSettings();
  const [reloading, setReloading] = useState(true);
  const pageCache = useMemo(() => createSettingsPageCache(), []);

  const unsaved = useUnsavedChanges();
  const { markDirty, markSaved, closeConfirmKey, reload: reloadUnsaved } = unsaved;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: PiWorkConfig) => {
        if (cancelled) return;
        setSettings(d);
        reloadUnsaved();
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReloading(false); });
    return () => { cancelled = true; };
  }, [reloadUnsaved]);

  const loading = reloading && config === null;

  const { apply } = useSettingsWrite();

  const reportDirty = useCallback<DirtyReporter>((key, dirty) => {
    if (dirty) markDirty(key);
    else markSaved(key);
  }, [markDirty, markSaved]);

  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(
    () => readLastSettingsSection() ?? DEFAULT_SETTINGS_SECTION_ID,
  );

  const goToSection = useCallback((target: SettingsSectionId) => {
    const decision = selectSectionLeave(unsaved, activeSectionId, target);
    if (decision.kind === "confirm" && !window.confirm(t(UNSAVED_CHANGES_CONFIRM_KEY))) {
      return;
    }
    if (decision.kind === "confirm") markSaved(decision.key);
    if (target !== activeSectionId) {
      writeLastSettingsSection(target);
      setActiveSectionId(target);
    }
  }, [activeSectionId, markSaved, t, unsaved]);

  const shouldConfirm = useCallback(() => {
    return closeConfirmKey ? t(closeConfirmKey) : true;
  }, [closeConfirmKey, t]);
  const { requestClose, backdropStyle, panelStyle } = useModalAnimation({
    isOpen: true,
    onClose,
    shouldConfirm,
  });

  if (loading) {
    return (
      <div style={backdropStyle}
        onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
        <div style={{ ...panelStyle, width: MODAL_WIDTH, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          {t("Loading...")}
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div style={backdropStyle}
        onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
        <div style={{ ...panelStyle, width: MODAL_WIDTH, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 40, textAlign: "center", color: "var(--error)" }}>
          {t("Failed to load settings")}
        </div>
      </div>
    );
  }

  const page = SETTINGS_PAGES[activeSectionId]({
    config,
    apply,
    reportDirty,
    onProfileSaved,
    pageCache,
  });

  return (
    <div style={backdropStyle}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div style={{ ...panelStyle, width: MODAL_WIDTH, height: "70vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("Settings")}</span>
          <button onClick={requestClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "180px 1fr",
            columnGap: 0,
            padding: "18px",
          }}
        >
          <nav
            aria-label={t("Settings sections")}
            style={{
              minHeight: 0,
              overflowY: "auto",
              paddingRight: 12,
              marginRight: 12,
              borderRight: "1px solid var(--border)",
            }}
          >
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.id} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--text-dim)",
                    padding: "0 10px 4px",
                  }}
                >
                  {t(group.labelKey)}
                </div>
                {sectionsForGroup(group.id).map((section) => {
                  const active = activeSectionId === section.id;
                  const dirtyDot = selectIsDirty(unsaved, section.id);
                  return (
                    <button
                      key={section.id}
                      onClick={() => goToSection(section.id)}
                      aria-current={active ? "page" : undefined}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 10px 6px 18px",
                        marginBottom: 2,
                        background: active ? "var(--bg-selected)" : "transparent",
                        border: "none",
                        borderRadius: 6,
                        color: active ? "var(--text)" : "var(--text-muted)",
                        fontSize: 13,
                        fontWeight: active ? 600 : 400,
                        cursor: "pointer",
                        transition: "background-color 0.15s, color 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t(section.labelKey)}
                      </span>
                      {dirtyDot && (
                        <span
                          title={t("Unsaved changes")}
                          style={{
                            width: 6,
                            height: 6,
                            flexShrink: 0,
                            borderRadius: "50%",
                            background: "var(--warning)",
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div
            key={activeSectionId}
            data-scroll-wide
            style={{
              minHeight: 0,
              overflowY: "auto",
              paddingRight: 6,
            }}
          >
            <SettingsSection id={activeSectionId}>{page}</SettingsSection>
          </div>
        </div>
      </div>
    </div>
  );
}
