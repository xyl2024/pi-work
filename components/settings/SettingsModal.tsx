"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { InboxTestSection } from "./InboxTestSection";
import { setSettings } from "@/hooks/settingsStore";
import type { PiWorkConfig } from "@/lib/shared/config-types";
import { NAV_ITEMS } from "./constants";
import { SettingsSection } from "./SettingsSection";
import { useImmediateApply } from "./use-immediate-apply";
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
 * Settings modal shell. Holds the global `config` state machine and the
 * modal chrome (backdrop, header, sidebar nav, scroll-spy). All
 * settings sections live under `components/settings/sections/`.
 *
 * Section layout (sidebar ↔ body, identical order to NAV_ITEMS):
 *   0  Profile             (own save flow; onDirtyChange → modal)
 *   1  Appearance          (no save — hooks apply immediately)
 *   2  Append System Prompt(textarea save + immediate-apply toggle;
 *                          onDirtyChange → modal)
 *   4  Right-side buttons  (immediate-apply; visibility / order /
 *                          alignment)
 *   5  Inbox Test          (<InboxTestSection />)
 *   6  Toast Test          (<ToastTestSection />, client-side preview)
 *   7  File preview limits (immediate-apply per kind)
 *   8  Agent retry         (independent state machine; lives in
 *                          ~/.pi/agent/settings.json, not config.yaml)
 *   9  Network proxy       (draft url + save; enable toggle immediate-apply;
 *                          hot-swaps the process fetch dispatcher)
 *   10 Subagent            (immediate-apply model + thinking level)
 *   11 UI Sounds           (immediate-apply master volume + per-event recipes)
 *   12 Web Access          (toggle + Tavily key)
 */
export function SettingsModal({
  onClose,
  onProfileSaved,
}: {
  onClose: () => void;
  onProfileSaved?: () => void;
}) {
  const { t } = useI18n();
  const [config, setConfig] = useState<PiWorkConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Unsaved-changes tracking from child sections ───────────────────
  // The textarea-backed AppendSystem section owns its own draft state
  // and reports dirty-ness back here so the close-confirm prompt can
  // warn before discarding those edits.
  const [appendSystemDirty, setAppendSystemDirty] = useState(false);

  // Initial load of /api/settings. Publish to the settings store so
  // AppShell reflects the snapshot on first paint; the
  // immediate-apply hook re-publishes on every PUT.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: PiWorkConfig) => {
        setConfig(d);
        setSettings(d);
      })
      .catch(() => { /* error shown in body via fallback rendering */ })
      .finally(() => setLoading(false));
  }, []);

  const apply = useImmediateApply({ config, setConfig });

  // ── Sidebar nav: active section + scroll-spy ───────────────────────
  // Default to the first nav item so the sidebar shows a highlighted
  // item before the user has scrolled. The IntersectionObserver
  // below updates this as the user scrolls past each section's top
  // edge into the trigger zone (top 40% of the scroll container).
  const [activeSectionId, setActiveSectionId] = useState<string>(NAV_ITEMS[0].id);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Depend on `config` so the observer is set up the first time the
  // body div actually mounts (the loading screen renders before it).
  // The cleanup disconnect + re-observe cost is negligible — there
  // are ~10 targets and the body div's identity is stable across
  // re-renders, so the observer's `root` reference stays valid.
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
        // topmost one (lowest boundingClientRect.top) wins. Picking
        // from the entries array (rather than re-querying all
        // sections) keeps updates bounded to what actually changed
        // this tick.
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
  // Encapsulated in useModalAnimation — backdrop fades + panel
  // slides on mount and on close. The hook drives a 220ms CSS
  // transition between phases (entering → open → leaving) and calls
  // `onClose` after the leaving animation finishes. The
  // `shouldConfirm` hook returns a string to gate the close on a
  // `window.confirm` prompt, `true` to close without prompting, or
  // `false` to abort.
  const shouldConfirm = useCallback(() => {
    if (appendSystemDirty) {
      return t("Discard unsaved changes?");
    }
    return true;
  }, [appendSystemDirty, t]);
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
        <div style={{ ...panelStyle, width: 880, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 40, textAlign: "center", color: "#ef4444" }}>
          {t("Failed to load settings")}
        </div>
      </div>
    );
  }

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
              column scrolls. alignSelf: start lets the nav shrink to its
              own height instead of stretching to fill the grid row. */}
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
            {NAV_ITEMS.map((item) => {
              const active = activeSectionId === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
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
                  {t(item.labelKey)}
                </button>
              );
            })}
          </nav>

          {/* Content column — all section wrappers go in here so the
              grid layout only sees two columns (nav + content). */}
          <div>
            {/* 0: Profile */}
            <ProfileSection onProfileSaved={onProfileSaved} />

            {/* 1: Appearance */}
            <AppearanceSection />

            {/* 2: Append System Prompt */}
            <AppendSystemSection
              config={config}
              apply={apply}
              onDirtyChange={setAppendSystemDirty}
            />

            {/* 3: Pi documentation */}
            <PiDocumentationSection config={config} apply={apply} />

            {/* 5: Right-side buttons */}
            <RightBarSection config={config} apply={apply} />

            {/* 6: Inbox Test */}
            <SettingsSection id="inbox-test" bottomGap={false}>
              <InboxTestSection />
            </SettingsSection>

            {/* 7: Toast Test — sits next to Inbox Test so the user can
                compare the two notification-style previews. Also purely
                client-side; no /api/toast/test endpoint needed. */}
            <SettingsSection id="toast-test" topGap>
              <ToastTestSection />
            </SettingsSection>

            {/* 8: File preview limits */}
            <FilePreviewSection config={config} apply={apply} />

            {/* 9: Agent retry */}
            <RetrySection />

            {/* 10: Network proxy */}
            <NetworkProxySection config={config} apply={apply} />

            {/* 10: Subagent */}
            <SubagentSection config={config} apply={apply} />

            {/* 11: UI Sounds */}
            <SoundSettingsSection config={config} apply={apply} />

            {/* 12: Web Access */}
            <WebAccessSection config={config} apply={apply} />

          </div>
        </div>
      </div>
    </div>
  );
}
