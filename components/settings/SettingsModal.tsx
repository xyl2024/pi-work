"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { setSettings, useSettings } from "@/hooks/settingsStore";
import { ICONS } from "@/components/ui/icons";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { UNSAVED_CHANGES_CONFIRM_KEY, selectIsDirty, selectSectionLeave } from "@/lib/shared/settings-unsaved";
import {
  DEFAULT_SETTINGS_SECTION_ID,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  sectionsForGroup,
  type SettingsSectionId,
} from "./registry";
import { readLastSettingsSection, writeLastSettingsSection } from "@/lib/client/last-settings-section";
import { createSettingsPageCache } from "@/lib/client/settings-page-cache";
import { useSettingsWrite } from "./use-settings-write";
import { useUnsavedChanges, type DirtyReporter } from "./use-unsaved-changes";
import { SETTINGS_PAGES } from "./pages";
import { SettingsSection, settingsPageTitleId } from "./SettingsSection";
import styles from "./SettingsModal.module.css";

export function SettingsModal({
  onClose,
  onProfileSaved,
  onOpenMemoryPanel,
}: {
  onClose: () => void;
  onProfileSaved?: () => void;
  onOpenMemoryPanel?: () => void;
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

  if (loading || !config) {
    return (
      <div style={backdropStyle} className={styles.backdrop}
        onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
        <div style={panelStyle}>
          <div className={`${styles.status} ${loading ? "" : styles.statusError}`}>
            {loading ? t("Loading...") : t("Failed to load settings")}
          </div>
        </div>
      </div>
    );
  }

  const activeSection = SETTINGS_SECTIONS.find((section) => section.id === activeSectionId)
    ?? SETTINGS_SECTIONS[0];

  const page = SETTINGS_PAGES[activeSectionId]({
    config,
    apply,
    reportDirty,
    onProfileSaved,
    onOpenMemoryPanel,
    pageCache,
  });

  return (
    <div style={backdropStyle} className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div style={panelStyle} className={styles.panel}>

        <aside className={styles.rail}>
          <div className={styles.railTitle}>{t("Settings")}</div>
          <nav className={styles.nav} aria-label={t("Settings sections")} data-scroll-side>
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.id} className={styles.group}>
                <div className={styles.groupLabel}>{t(group.labelKey)}</div>
                {sectionsForGroup(group.id).map((section) => {
                  const active = activeSectionId === section.id;
                  const dirtyDot = selectIsDirty(unsaved, section.id);
                  const Icon = ICONS[section.icon];
                  return (
                    <button
                      key={section.id}
                      onClick={() => goToSection(section.id)}
                      aria-current={active ? "page" : undefined}
                      className={[styles.navItem, active ? styles.navItemActive : ""].filter(Boolean).join(" ")}
                    >
                      <span className={styles.navIcon} aria-hidden="true">
                        <Icon size={15} />
                      </span>
                      <span className={styles.navLabel}>{t(section.labelKey)}</span>
                      {dirtyDot && (
                        <span
                          title={t("Unsaved changes")}
                          aria-hidden="true"
                          className={styles.dirtyDot}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <div className={styles.content}>
          <header className={styles.contentHeader}>
            <h2 id={settingsPageTitleId(activeSection.id)} className={styles.pageTitle}>
              {t(activeSection.labelKey)}
            </h2>
            <button
              onClick={requestClose}
              className={styles.close}
              aria-label={t("Close")}
            >
              <ICONS.close size={16} />
            </button>
          </header>

          <div
            key={activeSectionId}
            data-scroll-wide
            className={styles.scroll}
          >
            <SettingsSection id={activeSectionId}>{page}</SettingsSection>
          </div>
        </div>
      </div>
    </div>
  );
}
