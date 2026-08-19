"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useToast } from "./Toast";
import { WeChatSettingsSection } from "./WeChatSettingsSection";
import { InboxTestSection } from "./InboxTestSection";
import { setSettings } from "@/hooks/settingsStore";
import type { PiWorkConfig } from "@/lib/config";
import { NAV_ITEMS } from "./settings/constants";
import { useImmediateApply } from "./settings/use-immediate-apply";
import { AppearanceSection } from "./settings/sections/AppearanceSection";
import { ProfileSection } from "./settings/sections/ProfileSection";
import { AppendSystemSection } from "./settings/sections/AppendSystemSection";
import { ClawdOnDeskSection } from "./settings/sections/ClawdOnDeskSection";
import { CustomToolsSection } from "./settings/sections/CustomToolsSection";
import { RightBarSection } from "./settings/sections/RightBarSection";
import { FilePreviewSection } from "./settings/sections/FilePreviewSection";
import { TypewriterEffectSection } from "./settings/sections/TypewriterEffectSection";
import { TypewriterSection } from "./settings/sections/TypewriterSection";
import { RetrySection } from "./settings/sections/RetrySection";

/**
 * Settings modal shell. Holds the global `config` state machine and the
 * modal chrome (backdrop, header, sidebar nav, scroll-spy). All
 * settings sections live under `components/settings/sections/`.
 *
 * Section layout (sidebar ↔ body, identical order to NAV_ITEMS):
 *   0  Profile             (own save flow; onDirtyChange → modal)
 *   1  Appearance          (no save — hooks apply immediately)
 *   2  WeChat Connection   (<WeChatSettingsSection />)
 *   3  Append System Prompt(textarea save + immediate-apply toggle;
 *                          onDirtyChange → modal)
 *   4  Clawd on Desk       (immediate-apply toggle, but the section
 *                          still uses the modal-wide Save button —
 *                          legacy quirk, slated for removal with the
 *                          clawd plugin)
 *   5  Custom Tools        (immediate-apply)
 *   6  Right-side buttons  (immediate-apply; visibility / order /
 *                          alignment)
 *   7  Inbox Test          (<InboxTestSection />)
 *   8  File preview limits (immediate-apply per kind)
 *   9  Typewriter effect   (immediate-apply toggle)
 *   10 Typewriter phrases  (own save flow; onDirtyChange → modal)
 *   11 Agent retry         (independent state machine; lives in
 *                          ~/.pi/agent/settings.json, not config.yaml)
 */
export function SettingsModal({
  onClose,
  onProfileSaved,
}: {
  onClose: () => void;
  onProfileSaved?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [config, setConfig] = useState<PiWorkConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<PiWorkConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Modal-wide "general Save" ───────────────────────────────────────
  // Only used by the Clawd section (legacy quirk — all other immediate-
  // apply sections skip Save and PUT on toggle). Goes away when the
  // clawd plugin is removed in a follow-up.
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  // ── Unsaved-changes tracking from child sections ───────────────────
  // The two textarea-backed sections (AppendSystem + Typewriter) own
  // their own draft state and report dirty-ness back here so the
  // close-confirm prompt can warn before discarding those edits.
  const [appendSystemDirty, setAppendSystemDirty] = useState(false);
  const [typewriterDirty, setTypewriterDirty] = useState(false);

  // Initial load of /api/settings. Publish to the settings store so
  // AppShell reflects the snapshot on first paint; the
  // immediate-apply hook re-publishes on every PUT.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: PiWorkConfig) => {
        setConfig(d);
        setOriginalConfig(d);
        setSettings(d);
      })
      .catch(() => { /* error shown in body via fallback rendering */ })
      .finally(() => setLoading(false));
  }, []);

  const apply = useImmediateApply({ config, setConfig, setOriginalConfig });

  // Dirty check — compare current config against the snapshot from initial load.
  const isDirty =
    !!config && !!originalConfig && JSON.stringify(config) !== JSON.stringify(originalConfig);

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOriginalConfig(config);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 1500);
      toast.show({ kind: "success", message: t("Settings saved") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to save settings") });
    } finally {
      setSaving(false);
    }
  }, [config, t, toast]);

  // ── Sidebar nav: active section + scroll-spy ───────────────────────
  // Default to the first nav item so the sidebar shows a highlighted
  // item before the user has scrolled. The IntersectionObserver
  // below updates this as the user scrolls past each section's top
  // edge into the trigger zone (top 40% of the scroll container).
  const [activeSectionId, setActiveSectionId] = useState<string>(NAV_ITEMS[0].id);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Depend on `config` so the observer is set up the first time the
  // body div actually mounts (the loading screen renders before it).
  // When `config` later changes (e.g. after a Save), the cleanup
  // disconnect + re-observe cost is negligible — there are ~10
  // targets and the body div's identity is stable across saves, so
  // the observer's `root` reference stays valid.
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
    if (isDirty || typewriterDirty || appendSystemDirty) {
      return t("Discard unsaved changes?");
    }
    return true;
  }, [isDirty, typewriterDirty, appendSystemDirty, t]);
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
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

            {/* 2: WeChat Connection */}
            <div data-settings-section="settings-section-wechat" style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>{t("WeChat Connection")}</h3>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.5 }}>
                {t("Manage WeChat connection.")}
              </p>
              <WeChatSettingsSection />
            </div>

            {/* 3: Append System Prompt */}
            <AppendSystemSection
              config={config}
              apply={apply}
              onDirtyChange={setAppendSystemDirty}
            />

            {/* 4: Clawd on Desk — uses modal-wide Save */}
            <ClawdOnDeskSection
              config={config}
              setConfig={setConfig}
              canSave={isDirty}
              saving={saving}
              savedOk={savedOk}
              onSave={() => void handleSave()}
            />

            {/* 5: Custom Tools */}
            <CustomToolsSection config={config} apply={apply} />

            {/* 6: Right-side buttons */}
            <RightBarSection config={config} apply={apply} />

            {/* 7: Inbox Test */}
            <div data-settings-section="settings-section-inbox-test">
              <InboxTestSection />
            </div>

            {/* 8: File preview limits */}
            <FilePreviewSection config={config} apply={apply} />

            {/* 9: Typewriter effect */}
            <TypewriterEffectSection config={config} apply={apply} />

            {/* 10: Typewriter phrases */}
            <TypewriterSection
              config={config}
              apply={apply}
              onDirtyChange={setTypewriterDirty}
            />

            {/* 11: Agent retry */}
            <RetrySection />
          </div>
        </div>
      </div>
    </div>
  );
}