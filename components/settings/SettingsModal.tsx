"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { InboxTestSection } from "./InboxTestSection";
import { setSettings, useSettings } from "@/hooks/settingsStore";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTION_IDS,
  sectionsForGroup,
  type SettingsSectionId,
} from "./registry";
import { SettingsSection } from "./SettingsSection";
import { useSettingsWrite } from "./use-settings-write";
import { useUnsavedChanges, type DirtyReporter } from "./use-unsaved-changes";
import { AppearanceSection } from "./sections/AppearanceSection";
import { ProfileSection } from "./sections/ProfileSection";
import { AppendSystemSection } from "./sections/AppendSystemSection";
import { PiDocumentationSection } from "./sections/PiDocumentationSection";
import { RightBarSection } from "./sections/RightBarSection";
import { FilePreviewSection } from "./sections/FilePreviewSection";
import { RetrySection } from "./sections/RetrySection";
import { NetworkProxySection } from "./sections/NetworkProxySection";
import { SubagentSection } from "./sections/SubagentSection";
import { SoundSettingsSection } from "./sections/SoundSettingsSection";
import { ToastTestSection } from "./sections/ToastTestSection";
import { WebAccessSection } from "./sections/WebAccessSection";

/**
 * Settings modal shell. Holds the modal chrome (backdrop, header,
 * sidebar nav, scroll-spy) and mounts one section per registry entry.
 *
 * Groups and sections come from `./registry` — the sidebar and the body's
 * group headings both derive from it in the same order, so the two cannot
 * drift. A section = one scroll target (`data-settings-section`) = one
 * sidebar entry.
 *
 * The modal owns no second copy of the config: it reads the settings store,
 * re-reads disk once on open, and writes through the single `useSettingsWrite`
 * entry. Staged sections report their dirty-ness to one unsaved-changes
 * registry, which is the only input to the close-confirm prompt.
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

  // ── Unsaved-changes registry ───────────────────────────────────────
  // Every staged setting reports its dirty-ness here. The close-confirm
  // prompt has one input: the registry's selector. Sections never keep their
  // own dirty flag for the modal to collect.
  const unsaved = useUnsavedChanges();
  const { markDirty, markSaved, closeConfirmKey, reload: reloadUnsaved } = unsaved;

  // Re-read disk every time the modal opens so the fields show the current
  // config.yaml, not a snapshot from whenever the store was last written
  // (another tab, a hand edit). There is exactly one mirror: the settings
  // store. Re-reading disk also resets the unsaved-changes baseline.
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

  const { apply, submit } = useSettingsWrite();

  const reportDirty = useCallback<DirtyReporter>((key, dirty) => {
    if (dirty) markDirty(key);
    else markSaved(key);
  }, [markDirty, markSaved]);

  // ── Sidebar nav: active section + scroll-spy ───────────────────────
  // Default to the first registry section so the sidebar shows a highlighted
  // item before the user has scrolled. The IntersectionObserver below updates
  // this as the user scrolls past each section's top edge into the trigger
  // zone (top 40% of the scroll container).
  const firstSectionId = `settings-section-${SETTINGS_SECTION_IDS[0]}`;
  const [activeSectionId, setActiveSectionId] = useState<string>(firstSectionId);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Depend on `config` so the observer is set up the first time the body div
  // actually mounts (the loading screen renders before it).
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const targets = Array.from(
      root.querySelectorAll<HTMLElement>("[data-settings-section]"),
    );
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Of the entries that just crossed into the trigger zone, the
        // topmost one (lowest boundingClientRect.top) wins.
        const intersecting = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (intersecting.length > 0) {
          const id = intersecting[0].target.getAttribute("data-settings-section");
          if (id) setActiveSectionId(id);
        }
      },
      { root, rootMargin: "0px 0px -60% 0px", threshold: 0 },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [config]);

  const handleNavClick = useCallback((id: string) => {
    setActiveSectionId(id);
    const root = bodyRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(
      `[data-settings-section="${id}"]`,
    );
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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
        <div style={{ ...panelStyle, width: 880, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          {t("Loading...")}
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div style={backdropStyle}
        onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
        <div style={{ ...panelStyle, width: 880, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 40, textAlign: "center", color: "var(--error)" }}>
          {t("Failed to load settings")}
        </div>
      </div>
    );
  }

  /** One registry section → its component (each renders its own wrapper). */
  const renderSection = (id: SettingsSectionId): ReactNode => {
    switch (id) {
      case "profile":
        return <ProfileSection onProfileSaved={onProfileSaved} onDirtyChange={reportDirty} />;
      case "appearance":
        return <AppearanceSection />;
      case "right-bar":
        return <RightBarSection config={config} apply={apply} />;
      case "ui-sounds":
        return <SoundSettingsSection config={config} apply={apply} />;
      case "file-preview":
        return <FilePreviewSection config={config} apply={apply} />;
      case "append-system":
        return <AppendSystemSection config={config} apply={apply} onDirtyChange={reportDirty} />;
      case "pi-documentation":
        return <PiDocumentationSection config={config} apply={apply} />;
      case "subagent":
        return <SubagentSection config={config} apply={apply} />;
      case "retry":
        return <RetrySection />;
      case "network-proxy":
        return <NetworkProxySection config={config} apply={apply} onDirtyChange={reportDirty} />;
      case "web-access":
        return <WebAccessSection config={config} apply={apply} submit={submit} onDirtyChange={reportDirty} />;
      case "inbox-test":
        return (
          <SettingsSection id="inbox-test">
            <InboxTestSection />
          </SettingsSection>
        );
      case "toast-test":
        return <ToastTestSection />;
    }
  };


  return (
    <div style={backdropStyle}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div style={{ ...panelStyle, width: 880, height: "70vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("Settings")}</span>
          <button onClick={requestClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          data-scroll-wide
          style={{
            flex: 1,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "180px 1fr",
            columnGap: 0,
            padding: "18px",
          }}
        >
          {/* Sidebar nav — sticky so it stays in view while the content
              column scrolls. Group headings match the body's headings. */}
          <nav
            aria-label={t("Settings sections")}
            style={{
              position: "sticky",
              top: 0,
              alignSelf: "start",
              paddingRight: 12,
              marginRight: 12,
              borderRight: "1px solid var(--border)",
              maxHeight: "calc(100% - 0px)",
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
                  const id = `settings-section-${section.id}`;
                  const active = activeSectionId === id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => handleNavClick(id)}
                      aria-current={active ? "true" : undefined}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 10px",
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
                      {t(section.labelKey)}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Content column — group headings and sections, both derived from
              the registry so the two columns read the same. */}
          <div>
            {SETTINGS_GROUPS.map((group, groupIndex) => (
              <div key={group.id}>
                <div
                  style={{
                    marginTop: groupIndex === 0 ? 0 : 20,
                    marginBottom: 8,
                    paddingBottom: 6,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      fontSize: group.developer ? 12 : 13,
                      fontWeight: 700,
                      letterSpacing: group.developer ? "0.04em" : undefined,
                      textTransform: group.developer ? "uppercase" : undefined,
                      color: group.developer ? "var(--text-dim)" : "var(--text)",
                    }}
                  >
                    {t(group.labelKey)}
                  </h2>
                  {group.descriptionKey && (
                    <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
                      {t(group.descriptionKey)}
                    </p>
                  )}
                </div>
                {sectionsForGroup(group.id).map((section) => (
                  <div key={section.id}>{renderSection(section.id)}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}