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

/** Wide enough for the prompt pages, never wider than the viewport. */
const MODAL_WIDTH = "min(960px, calc(100vw - 32px))";

/**
 * Settings modal shell. Holds the modal chrome (backdrop, header, sidebar
 * navigation) and renders exactly one registry section at a time.
 *
 * Groups and sections come from `./registry`: the sidebar is the only place
 * the registry is laid out, and the page map in `./pages` is keyed by section
 * id, so a section without a page fails type checking. Navigation state is the
 * section id itself — there is no scroll-anchor layer anymore. The id is
 * remembered in localStorage on every page switch and re-read on open, so the
 * modal comes back to the page the user left on (default: Profile).
 *
 * The modal owns no second copy of the config: it reads the settings store,
 * re-reads disk once on open, and writes through the single `useSettingsWrite`
 * entry. Staged sections report their dirty-ness to one unsaved-changes
 * registry, which is the only input to both confirms (close and page switch) —
 * same `window.confirm`, same copy.
 *
 * Pages that load their own data share one page-data cache created here, so
 * switching away and back reuses what was already loaded (no second request,
 * no loading flash) while the page component itself still unmounts. The cache
 * dies with the modal, so reopening settings fetches again.
 */
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
  // Per-modal page-data cache: one entry per page that fetches on mount,
  // discarded when this modal unmounts (i.e. on close).
  const pageCache = useMemo(() => createSettingsPageCache(), []);

  // ── Unsaved-changes registry ───────────────────────────────────────
  // Every staged setting reports its dirty-ness here. The close-confirm
  // prompt has one input: the registry's selector. Sections never keep their
  // own dirty flag for the modal to collect.
  const unsaved = useUnsavedChanges();
  const { markDirty, markSaved, closeConfirmKey, reload: reloadUnsaved } = unsaved;

  // Re-read on every open so the fields show the current config.yaml, not the
  // snapshot the store last wrote. The server serves that read from its
  // in-process cache while the file is unchanged (see lib/server/config.ts): a
  // write from this process is visible immediately, and a hand edit (another
  // tab, a manual edit) lands as soon as the file's mtime/size moves. There is
  // exactly one mirror: the settings store. Re-reading also resets the
  // unsaved-changes baseline.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: PiWorkConfig) => {
        if (cancelled) return;
        setSettings(d);
        reloadUnsaved();
      })
      .catch(() => { /* error shown in body via fallback rendering */ })
      .finally(() => { if (!cancelled) setReloading(false); });
    return () => { cancelled = true; };
  }, [reloadUnsaved]);

  const loading = reloading && config === null;

  const { apply } = useSettingsWrite();

  const reportDirty = useCallback<DirtyReporter>((key, dirty) => {
    if (dirty) markDirty(key);
    else markSaved(key);
  }, [markDirty, markSaved]);

  // ── Pagination: the active section is the whole navigation state ───
  // Open on the section the user last looked at. `readLastSettingsSection`
  // validates the stored id against the registry and returns null for a
  // missing / stale / unreachable-store value, which falls back to Profile.
  // The read is lazy so it happens once per open, not on every render.
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(
    () => readLastSettingsSection() ?? DEFAULT_SETTINGS_SECTION_ID,
  );

  /**
   * Navigate to a page, honouring staged edits.
   *
   * `selectSectionLeave` decides whether the switch needs a confirm; when it
   * does, the prompt is the *same* `window.confirm` and the same copy as the
   * close guard. The page being left is the one that loses its draft on
   * unmount, so confirming drops that page's dirty flag as part of the switch;
   * closing the modal afterwards therefore does not ask a second time about
   * changes that were already dropped.
   */
  const goToSection = useCallback((target: SettingsSectionId) => {
    const decision = selectSectionLeave(unsaved, activeSectionId, target);
    if (decision.kind === "confirm" && !window.confirm(t(UNSAVED_CHANGES_CONFIRM_KEY))) {
      return;
    }
    if (decision.kind === "confirm") markSaved(decision.key);
    if (target !== activeSectionId) {
      // Remember on the switch itself (not on every render), so reopening the
      // modal lands here. Re-clicking the open page is not a navigation.
      writeLastSettingsSection(target);
      setActiveSectionId(target);
    }
  }, [activeSectionId, markSaved, t, unsaved]);

  // ── Open/close animation ──────────────────────────────────────────
  // `shouldConfirm` returns a string to gate the close on a confirm prompt,
  // `true` to close without prompting. The unsaved-changes registry is the
  // only thing it consults.
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

        {/* Header — the only sticky part of the modal. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("Settings")}</span>
          <button onClick={requestClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {/* Body: navigation + one page. The page column is keyed by the active
            section so switching pages starts at the top instead of inheriting
            the previous page's scroll offset. */}
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
                {/* Group headings are labels, never navigation. */}
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
                        // Menu items sit one step in from the group label and
                        // description, which stay flush with the nav edge.
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
                        // Staged edits that have not hit disk yet. The dot is
                        // decoration — the accessible name stays the page name
                        // — with a title for pointer users.
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
