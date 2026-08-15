"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme, PRESETS, PRESET_LABELS } from "@/hooks/useTheme";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { useToast } from "./Toast";
import { WeChatSettingsSection } from "./WeChatSettingsSection";
import { InboxTestSection } from "./InboxTestSection";
import type { PiWorkConfig, RightBarButtonId, RightSideBarConfig, AgentCustomToolName } from "@/lib/config";
import { FILE_VIEWER_LIMITS, FILE_VIEWER_KINDS, type FileViewerKind, type FileViewerMaxSizeMb } from "@/lib/file-viewer-limits";
import { setSettings } from "@/hooks/settingsStore";
import {
  DEFAULT_TYPEWRITER_PHRASES,
  parseTypewriterPhraseList,
} from "@/lib/typewriter-phrases";
import type { Locale } from "@/lib/i18n-dict";

// Display order for the "Right-side buttons" section checkboxes. Each row
// reuses an existing i18n key (originally written for the right-bar button
// tooltip) — one key per concept keeps the dictionary small.
const RIGHT_BAR_BUTTONS_UI: Array<{ id: RightBarButtonId; labelKey: string }> = [
  { id: "todos",     labelKey: "Open todos" },
  { id: "canvas",    labelKey: "Open canvas" },
  { id: "translate", labelKey: "Open translate" },
  { id: "json",      labelKey: "JSON" },
  { id: "rss",       labelKey: "RSS" },
  { id: "favorites", labelKey: "Open favorites" },
  { id: "tokens",    labelKey: "Open token audit" },
  { id: "toolCalls", labelKey: "Tool Calls" },
  { id: "gitDiff",   labelKey: "Open git diff" },
  { id: "conversationTree", labelKey: "Open conversation tree" },
];

// Display order for the "Custom Tools" section checkboxes. Tools are
// registered on `createAgentSession` (see lib/rpc-manager.ts) and the
// enabled subset is sourced from `custom_tools.enabled` in
// ~/.pi-work/config.yaml. Toggling here writes the full PiWorkConfig back
// via /api/settings — same immediate-apply pattern as Right-side buttons.
const CUSTOM_TOOLS_UI: Array<{ id: AgentCustomToolName; labelKey: string }> = [
  { id: "agent_todo", labelKey: "Agent Todo" },
  { id: "show_media", labelKey: "Show Media" },
  { id: "ask_user_questions", labelKey: "Ask User Questions" },
];

// Display order for the "File preview limits" section number inputs. The
// ranges mirror lib/config.ts#FILE_VIEWER_LIMITS — duplicated here so the
// UI can render per-kind `min` / `max` HTML attributes without a second
// round-trip to the server. Keep these in sync if FILE_VIEWER_LIMITS
// changes.
const FILE_VIEWER_UI: Array<{ kind: FileViewerKind; labelKey: string }> = [
  { kind: "text",  labelKey: "Max size for text / code files" },
  { kind: "image", labelKey: "Max size for image files" },
  { kind: "pdf",   labelKey: "Max size for PDF files" },
];

// Sidebar nav entries for the modal body. The id is the value of
// `data-settings-section` on each section's wrapper div; clicking an entry
// scrolls the body to that section. Order here is the display order in
// the sidebar (same as the body's top-to-bottom order) — keep them in
// sync if you reorder sections.
const NAV_ITEMS: Array<{ id: string; labelKey: string }> = [
  { id: "settings-section-profile",       labelKey: "Profile" },
  { id: "settings-section-appearance",    labelKey: "Appearance" },
  { id: "settings-section-wechat",        labelKey: "WeChat Connection" },
  { id: "settings-section-append-system", labelKey: "Append System Prompt" },
  { id: "settings-section-clawd",         labelKey: "Clawd on Desk" },
  { id: "settings-section-custom-tools",  labelKey: "Custom Tools" },
  { id: "settings-section-right-bar",     labelKey: "Right-side buttons" },
  { id: "settings-section-inbox-test",    labelKey: "Inbox Test" },
  { id: "settings-section-file-preview",  labelKey: "File preview limits" },
  { id: "settings-section-typewriter",    labelKey: "Typewriter phrases" },
];

/**
 * One row in the "File preview limits" section. The row owns a local
 * `draft` string so the user can type freely (including transient
 * invalid states like empty / decimal) without losing focus; on blur or
 * Enter we parse + range-check, and on success we call `onCommit(next)`
 * which the modal wires to a settings-store write. Invalid input never
 * reaches the PUT — the row rolls the draft back to the last accepted
 * value and shows a short inline error in the theme's danger color.
 */
function FileViewerLimitRow({
  kind,
  label,
  min,
  max,
  value,
  onCommit,
}: {
  kind: FileViewerKind;
  label: string;
  min: number;
  max: number;
  value: number;
  onCommit: (next: number) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string>(String(value));
  const [error, setError] = useState<string | null>(null);

  // Re-sync the draft when the authoritative value changes (e.g. PUT
  // succeeded and settingsStore emitted, or rollback on PUT failure).
  // Skipping the sync while the input is in an error state would let
  // the rolled-back draft survive — always mirror the prop so the row
  // tells the truth about what's on disk.
  useEffect(() => {
    setDraft(String(value));
    setError(null);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setError(t("Value must not be empty"));
      setDraft(String(value));
      return;
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
      setError(t("Must be between {min} and {max}", { min, max }));
      setDraft(String(value));
      return;
    }
    setError(null);
    if (num !== value) onCommit(num);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 4px 0" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="number"
          min={min}
          max={max}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // Clear the error as soon as the user starts editing again,
            // so the red border doesn't linger on an in-progress fix.
            if (error) setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          aria-invalid={error ? "true" : undefined}
          style={{
            width: 80,
            height: 30,
            padding: "4px 8px",
            background: "var(--bg-panel)",
            border: `1px solid ${error ? "#ef4444" : "var(--border)"}`,
            borderRadius: 6,
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>MB</span>
        {error && (
          <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
        {t("Range: {min}–{max} MB", { min, max })}
      </div>
    </div>
  );
}

export function SettingsModal({ onClose, onProfileSaved }: { onClose: () => void; onProfileSaved?: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { preset, setPreset } = useTheme();
  const toast = useToast();
  const [config, setConfig] = useState<PiWorkConfig | null>(null);
  const [profileUsername, setProfileUsername] = useState<string>("");
  const [originalUsername, setOriginalUsername] = useState<string>("");
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [avatarAttempt, setAvatarAttempt] = useState(0);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [profileSavedOk, setProfileSavedOk] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [originalConfig, setOriginalConfig] = useState<PiWorkConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  // ── Append System Prompt (~/.pi/agent/APPEND_SYSTEM.md) ──
  const [appendSystem, setAppendSystem] = useState<{ content: string; path: string; exists: boolean } | null>(null);
  const [originalAppendSystem, setOriginalAppendSystem] = useState<string>("");
  const [appendSystemLoading, setAppendSystemLoading] = useState(true);
  const [appendSystemSaving, setAppendSystemSaving] = useState(false);
  const [appendSystemSavedOk, setAppendSystemSavedOk] = useState(false);

  // ── Typewriter phrases (chat input placeholder) ──
  // Per-locale textareas, one phrase per line. Parsed back into a
  // string[] at save time via parseTypewriterPhraseList (which trims,
  // drops empties, and de-dupes — same rules as the server-side parser).
  const [typewriterDraft, setTypewriterDraft] = useState<Record<Locale, string>>({
    en: "", zh: "",
  });
  const [originalTypewriterDraft, setOriginalTypewriterDraft] = useState<Record<Locale, string>>({
    en: "", zh: "",
  });
  const [typewriterSaving, setTypewriterSaving] = useState(false);
  const [typewriterSavedOk, setTypewriterSavedOk] = useState(false);

  // Seed the draft from the loaded config once it's available. Using a
  // ref so we don't reset the user's edits if `config` later changes
  // (e.g. after we save and write the new snapshot back into local
  // state). The Append System Prompt effect uses an empty-dep pattern
  // for the same reason — we only want to seed once.
  const typewriterSeededRef = useRef(false);
  useEffect(() => {
    if (typewriterSeededRef.current) return;
    if (!config) return;
    const seeded: Record<Locale, string> = {
      en: config.typewriter_phrases.en.join("\n"),
      zh: config.typewriter_phrases.zh.join("\n"),
    };
    typewriterSeededRef.current = true;
    setTypewriterDraft(seeded);
    setOriginalTypewriterDraft(seeded);
  }, [config]);

  // ── Sidebar nav: active section + scroll-spy ──
  // Default to the first nav item so the sidebar shows a highlighted item
  // before the user has scrolled. The IntersectionObserver below updates
  // this as the user scrolls past each section's top edge into the
  // trigger zone (top 40% of the scroll container).
  const [activeSectionId, setActiveSectionId] = useState<string>(NAV_ITEMS[0].id);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Depend on `config` so the observer is set up the first time the body
  // div actually mounts (the loading screen renders before it). When
  // `config` later changes (e.g. after a Save), the cleanup disconnect +
  // re-observe cost is negligible — there are ~10 targets and the body
  // div's identity is stable across saves, so the observer's `root`
  // reference stays valid.
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
        // from the entries array (rather than re-querying all sections)
        // keeps updates bounded to what actually changed this tick.
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

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: PiWorkConfig) => {
        setConfig(d);
        setOriginalConfig(d);
        setSettings(d); // publish to the store so AppShell reflects this snapshot
      })
      .catch(() => { /* error shown in body via fallback rendering */ })
      .finally(() => setLoading(false));
  }, []);

  // Load ~/.pi/agent/APPEND_SYSTEM.md (independent from main config save flow)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/append-system")
      .then((r) => r.json())
      .then((d: { content?: string; path?: string; exists?: boolean; error?: string }) => {
        if (cancelled) return;
        if (d.error || typeof d.content !== "string" || typeof d.path !== "string") return;
        setAppendSystem({ content: d.content, path: d.path, exists: !!d.exists });
        setOriginalAppendSystem(d.content);
      })
      .catch(() => { /* leave empty: section shows a "not loaded" hint */ })
      .finally(() => { if (!cancelled) setAppendSystemLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Load profile (username + avatar presence) once on mount
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) {
          if (!cancelled) setProfileUsername("");
          return;
        }
        const data = (await res.json()) as { username: string | null };
        if (cancelled) return;
        setProfileUsername(data.username ?? "");
        setOriginalUsername(data.username ?? "");
      } catch {
        if (!cancelled) setProfileUsername("");
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };
    void load();
    // Probe avatar with HEAD-equivalent: use GET and read the response.
    // If the response is 200, the avatar exists; if 404, it does not.
    fetch("/api/profile/avatar", { method: "GET", cache: "no-store" })
      .then((r) => {
        if (!cancelled) setHasAvatar(r.ok);
        // Burn the body so the connection is released.
        if (r.ok) void r.arrayBuffer();
        else void r.text();
      })
      .catch(() => { if (!cancelled) setHasAvatar(false); });
    return () => { cancelled = true; };
  }, []);

  const profileDirty = profileUsername.trim() !== originalUsername || avatarRemoved;
  const profileCanSave = profileDirty && !profileSaving && !profileSavedOk;

  const handleProfileSave = useCallback(async () => {
    setProfileSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: profileUsername.trim() === "" ? null : profileUsername.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { username: string | null };
      const saved = data.username ?? "";
      setProfileUsername(saved);
      setOriginalUsername(saved);
      if (avatarRemoved) {
        setAvatarRemoved(false);
        setHasAvatar(false);
      }
      setProfileSavedOk(true);
      setTimeout(() => setProfileSavedOk(false), 1500);
      onProfileSaved?.();
      toast.show({ kind: "success", message: t("Profile saved") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to save profile") });
    } finally {
      setProfileSaving(false);
    }
  }, [profileUsername, avatarRemoved, onProfileSaved, t, toast]);

  const handleAvatarFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (file.type !== "image/png") {
      toast.show({ kind: "error", message: t("Only PNG images are supported") });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.show({ kind: "error", message: t("File too large (max 5MB)") });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/profile/avatar", { method: "POST", body: form });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setHasAvatar(true);
      setAvatarAttempt((n) => n + 1);
      setAvatarRemoved(false);
      onProfileSaved?.();
      toast.show({ kind: "success", message: t("Avatar uploaded") });
    } catch (err) {
      toast.show({ kind: "error", message: err instanceof Error && err.message ? err.message : t("Failed to upload avatar") });
    }
  }, [onProfileSaved, t, toast]);

  const handleAvatarRemove = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHasAvatar(false);
      setAvatarRemoved(true);
      setAvatarAttempt((n) => n + 1);
      onProfileSaved?.();
      toast.show({ kind: "success", message: t("Avatar removed") });
    } catch (err) {
      toast.show({ kind: "error", message: err instanceof Error && err.message ? err.message : t("Failed to remove avatar") });
    }
  }, [onProfileSaved, t, toast]);

  const handleClawdOnDeskToggle = useCallback(() => {
    setConfig((prev) => (prev ? {
      ...prev,
      extensions: {
        ...prev.extensions,
        clawd_on_desk: { enabled: !prev.extensions.clawd_on_desk.enabled },
      },
    } : prev));
  }, []);

  // Right-side button bar visibility — applies immediately on toggle (no
  // per-section Save button, unlike the Profile / Clawd / Append System
  // Prompt sections which have multi-step flows). Sets local config + the
  // global store + persists to /api/settings. Keeps `isDirty` false so the
  // modal's close-confirm prompt is not triggered by these toggles.
  const handleRightBarToggle = useCallback(async (id: RightBarButtonId) => {
    if (!config) return;
    const currentlyVisible = config.right_side_bar[id] !== false;
    const nextRightSideBar: RightSideBarConfig = {
      ...config.right_side_bar,
      [id]: !currentlyVisible,
    };
    const nextConfig: PiWorkConfig = { ...config, right_side_bar: nextRightSideBar };
    setConfig(nextConfig);
    setOriginalConfig(nextConfig); // keep isDirty=false → no "discard changes?" prompt
    setSettings(nextConfig);       // publish → AppShell re-renders / auto-closes active panel
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextConfig),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.show({ kind: "success", message: t("Settings saved") });
    } catch (e) {
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to save settings"),
      });
    }
  }, [config, t, toast]);

  // Custom tool enable/disable — same immediate-apply pattern as
  // handleRightBarToggle. Modifies the enabled array in-place and PUTs the
  // whole PiWorkConfig back; the server's parseCustomTools validates and
  // silently drops unknown names on read. An empty `enabled` array is
  // honored as "disable everything" (the user pushed the buttons, we
  // trust them). Toggling here only affects sessions started AFTER the
  // PUT — running sessions keep the tool set they were created with
  // (createAgentSession freezes customTools).
  const handleCustomToolToggle = useCallback(async (id: AgentCustomToolName) => {
    if (!config) return;
    const isEnabled = config.custom_tools.enabled.includes(id);
    const nextEnabled: AgentCustomToolName[] = isEnabled
      ? config.custom_tools.enabled.filter((name) => name !== id)
      : [...config.custom_tools.enabled, id];
    const nextConfig: PiWorkConfig = {
      ...config,
      custom_tools: { enabled: nextEnabled },
    };
    setConfig(nextConfig);
    setOriginalConfig(nextConfig);
    setSettings(nextConfig);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextConfig),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.show({ kind: "success", message: t("Settings saved") });
    } catch (e) {
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to save settings"),
      });
    }
  }, [config, t, toast]);

  // APPEND_SYSTEM.md loader toggle. Same immediate-apply pattern as
  // handleRightBarToggle — PUTs the whole PiWorkConfig and keeps isDirty
  // false so the modal's close-confirm prompt is not triggered. Changes
  // only take effect on sessions started AFTER the PUT (rpc-manager reads
  // the flag once per session start, same as clawd_on_desk / custom_tools).
  const handleAppendSystemEnabledToggle = useCallback(async () => {
    if (!config) return;
    const nextConfig: PiWorkConfig = {
      ...config,
      append_system: { enabled: !config.append_system.enabled },
    };
    setConfig(nextConfig);
    setOriginalConfig(nextConfig);
    setSettings(nextConfig);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextConfig),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.show({ kind: "success", message: t("Settings saved") });
    } catch (e) {
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to save settings"),
      });
    }
  }, [config, t, toast]);

  // File preview size limit — per-kind MB. Same immediate-apply pattern
  // as the right-bar / custom-tools toggles: PUT the whole PiWorkConfig
  // and keep modal isDirty=false so closing the modal doesn't prompt
  // "discard changes?". Already-open file tabs keep showing the
  // existing file (Q9 decision: don't force-refetch); the new limit
  // takes effect on the next read.
  const handleFileViewerLimitChange = useCallback(async (
    kind: FileViewerKind,
    next: number,
  ) => {
    if (!config) return;
    const { min, max } = FILE_VIEWER_LIMITS[kind];
    // Defense in depth: the input row already validates on blur, but a
    // direct caller (or a regression in that row) shouldn't be able to
    // PUT an out-of-range value past this handler either.
    if (!Number.isInteger(next) || next < min || next > max) {
      toast.show({
        kind: "error",
        message: t("Must be between {min} and {max}", { min, max }),
      });
      return;
    }
    const nextMaxSizeMb: FileViewerMaxSizeMb = {
      ...config.file_viewer.max_size_mb,
      [kind]: next,
    };
    const nextConfig: PiWorkConfig = {
      ...config,
      file_viewer: { max_size_mb: nextMaxSizeMb },
    };
    const previousConfig = config;
    setConfig(nextConfig);
    setOriginalConfig(nextConfig);
    setSettings(nextConfig);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextConfig),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.show({ kind: "success", message: t("Settings saved") });
    } catch (e) {
      // Roll back the optimistic local update so the row reflects the
      // actual on-disk value (not the rejected write).
      setConfig(previousConfig);
      setOriginalConfig(previousConfig);
      setSettings(previousConfig);
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to save settings"),
      });
    }
  }, [config, t, toast]);

  // Dirty check — compare current config against the snapshot from initial load
  const isDirty = !!config && !!originalConfig && JSON.stringify(config) !== JSON.stringify(originalConfig);

  const appendSystemDirty = !!appendSystem && appendSystem.content !== originalAppendSystem;

  const typewriterDirty =
    typewriterDraft.en !== originalTypewriterDraft.en ||
    typewriterDraft.zh !== originalTypewriterDraft.zh;

  const handleAppendSystemSave = useCallback(async () => {
    if (!appendSystem) return;
    setAppendSystemSaving(true);
    try {
      const res = await fetch("/api/append-system", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: appendSystem.content }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setOriginalAppendSystem(appendSystem.content);
      setAppendSystem((prev) => (prev ? { ...prev, exists: true } : prev));
      setAppendSystemSavedOk(true);
      setTimeout(() => setAppendSystemSavedOk(false), 1500);
      toast.show({ kind: "success", message: t("Append system prompt saved") });
    } catch (e) {
      toast.show({ kind: "error", message: e instanceof Error && e.message ? e.message : t("Failed to save append system prompt") });
    } finally {
      setAppendSystemSaving(false);
    }
  }, [appendSystem, t, toast]);

  const canSave = isDirty;

  // Typewriter phrases save — parses each textarea back into a clean
  // string[] (trim, drop empties, de-dupe; same rules as the server-side
  // parser so what the modal sends matches what gets stored). Empty
  // results for either locale fall back to the bundled defaults so a
  // accidental clear in the textarea can't break the chat input.
  const handleTypewriterSave = useCallback(async () => {
    if (!config) return;
    setTypewriterSaving(true);
    try {
      const nextEn = parseTypewriterPhraseList(
        typewriterDraft.en.split("\n"),
        DEFAULT_TYPEWRITER_PHRASES.en,
      );
      const nextZh = parseTypewriterPhraseList(
        typewriterDraft.zh.split("\n"),
        DEFAULT_TYPEWRITER_PHRASES.zh,
      );
      const nextConfig: PiWorkConfig = {
        ...config,
        typewriter_phrases: { en: nextEn, zh: nextZh },
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextConfig),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfig(nextConfig);
      setOriginalConfig(nextConfig);
      setSettings(nextConfig); // publish → chat input picks up new phrases on the next render
      const reseeded: Record<Locale, string> = {
        en: nextEn.join("\n"),
        zh: nextZh.join("\n"),
      };
      setTypewriterDraft(reseeded);
      setOriginalTypewriterDraft(reseeded);
      setTypewriterSavedOk(true);
      setTimeout(() => setTypewriterSavedOk(false), 1500);
      toast.show({ kind: "success", message: t("Settings saved") });
    } catch (e) {
      toast.show({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : t("Failed to save settings"),
      });
    } finally {
      setTypewriterSaving(false);
    }
  }, [config, typewriterDraft, t, toast]);

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

  // (Kept for a planned future feature; not currently consumed.)
  const savedOkRef = useRef(savedOk);
  savedOkRef.current = savedOk;

  // ── Open/close animation ────────────────────────────────────────────
  // Encapsulated in useModalAnimation — backdrop fades + panel slides
  // on mount and on close. The hook drives a 220ms CSS transition
  // between phases (entering → open → leaving) and calls `onClose`
  // after the leaving animation finishes. The `shouldConfirm` hook
  // returns a string to gate the close on a `window.confirm` prompt,
  // `true` to close without prompting, or `false` to abort.
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

  const clawdOnDeskEnabled = config?.extensions.clawd_on_desk.enabled ?? false;

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

          {/* Content column — all section wrappers go in here so the grid
              layout only sees two columns (nav + content). */}
          <div>
          {/* ── Section 0: Profile (avatar + username) ── */}
          <div data-settings-section="settings-section-profile" style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>{t("Profile")}</h3>
              <button
                onClick={handleProfileSave}
                disabled={!profileCanSave}
                style={{
                  padding: "4px 14px", height: 28,
                  background: profileSavedOk ? "#16a34a" : profileSaving ? "var(--bg-panel)" : "var(--accent)",
                  border: "none", borderRadius: 6,
                  color: profileSavedOk ? "#fff" : profileSaving ? "var(--text-muted)" : "#fff",
                  cursor: profileCanSave ? "pointer" : "default",
                  fontSize: 12, fontWeight: 600,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "background-color 0.2s ease, color 0.2s ease",
                  opacity: profileCanSave ? 1 : 0.5,
                }}
              >
                {profileSavedOk && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span>{profileSavedOk ? t("Saved") : profileSaving ? t("Saving...") : t("Save")}</span>
              </button>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.5 }}>
              {t("Avatar and display name shown at the bottom of the sidebar.")}
            </p>

            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 14 }}>
              <div
                style={{
                  width: 64, height: 64, flexShrink: 0,
                  borderRadius: "50%", overflow: "hidden",
                  background: "var(--bg-panel)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "1px solid var(--border)",
                  position: "relative",
                }}
              >
                {hasAvatar && !avatarRemoved ? (
                  <img
                    key={`preview-${avatarAttempt}`}
                    src={`/api/profile/avatar?k=${avatarAttempt}`}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={() => setHasAvatar(false)}
                  />
                ) : (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}>
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </div>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png"
                  onChange={handleAvatarFileChange}
                  style={{ display: "none" }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: "6px 12px", height: 32,
                    background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6,
                    color: "var(--text)", fontSize: 12, fontWeight: 500,
                    cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 6,
                    transition: "border-color 0.15s, color 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text)"; }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {t("Upload avatar")}
                </button>
                <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
                  {t("PNG only · up to 5MB")}
                </span>
                {hasAvatar && !avatarRemoved && (
                  <button
                    onClick={handleAvatarRemove}
                    style={{
                      padding: "4px 10px", height: 26,
                      background: "none", border: "1px solid var(--border)", borderRadius: 6,
                      color: "var(--text-muted)", fontSize: 11,
                      cursor: "pointer",
                      transition: "color 0.15s, border-color 0.15s",
                      alignSelf: "flex-start",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "#ef4444"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
                  >
                    {t("Remove avatar")}
                  </button>
                )}
              </div>
            </div>

            <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px 0" }}>{t("Username")}</div>
            <input
              type="text"
              placeholder={t("Your display name")}
              value={profileUsername}
              onChange={(e) => setProfileUsername(e.target.value)}
              disabled={profileLoading}
              maxLength={64}
              style={{
                width: "100%", height: 32, padding: "4px 10px",
                background: "var(--bg-panel)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text)", fontSize: 13,
                outline: "none",
              }}
            />
          </div>

          {/* ── Section 1: Appearance (theme + language, applied immediately) ── */}
          <div data-settings-section="settings-section-appearance" style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 12px 0" }}>{t("Appearance")}</h3>

            {/* Theme swatches */}
            <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0" }}>{t("Theme")}</div>
            <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={(e: React.MouseEvent) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPreset(p, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                  }}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6,
                    padding: 0, background: "none", border: "none", cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: 100, height: 60, borderRadius: 8,
                      border: preset === p ? "2px solid var(--accent)" : "2px solid var(--border)",
                      background: p === "default"
                        ? "linear-gradient(135deg, #fafafa 50%, #6366f1 50%)"
                        : p === "midnight"
                        ? "linear-gradient(135deg, #0f172a 50%, #818cf8 50%)"
                        : p === "synthwave"
                        ? "linear-gradient(135deg, #1e1b4b 50%, #f472b6 50%)"
                        : p === "forest"
                        ? "linear-gradient(135deg, #f0fdf4 50%, #16a34a 50%)"
                        : "linear-gradient(135deg, #fdf6e3 50%, #b45309 50%)",
                      transition: "border-color 0.15s",
                    }}
                  />
                  <div style={{
                    fontSize: 11, textAlign: "center",
                    color: preset === p ? "var(--accent)" : "var(--text-muted)",
                    fontWeight: preset === p ? 600 : 400,
                  }}>
                    {PRESET_LABELS[p][locale]}
                  </div>
                </button>
              ))}
            </div>

            {/* Language buttons */}
            <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0" }}>{t("Language")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setLocale("en")}
                style={{
                  flex: 1, height: 36,
                  background: locale === "en" ? "var(--accent)" : "var(--bg-panel)",
                  border: "1px solid var(--border)", borderRadius: 6,
                  color: locale === "en" ? "#fff" : "var(--text)",
                  cursor: "pointer", fontSize: 13, fontWeight: locale === "en" ? 600 : 500,
                  transition: "background-color 0.15s, color 0.15s",
                }}
              >
                {t("English")}
              </button>
              <button
                onClick={() => setLocale("zh")}
                style={{
                  flex: 1, height: 36,
                  background: locale === "zh" ? "var(--accent)" : "var(--bg-panel)",
                  border: "1px solid var(--border)", borderRadius: 6,
                  color: locale === "zh" ? "#fff" : "var(--text)",
                  cursor: "pointer", fontSize: 13, fontWeight: locale === "zh" ? 600 : 500,
                  transition: "background-color 0.15s, color 0.15s",
                }}
              >
                {t("Chinese")}
              </button>
            </div>
          </div>

          {/* ── Section 2: WeChat Connection ── */}
          <div data-settings-section="settings-section-wechat" style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>{t("WeChat Connection")}</h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.5 }}>
              {t("Manage WeChat connection.")}
            </p>
            <WeChatSettingsSection />
          </div>

          {/* ── Section 3: Append System Prompt (~/.pi/agent/APPEND_SYSTEM.md) ── */}
          <div data-settings-section="settings-section-append-system" style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>{t("Append System Prompt")}</h3>
              <button
                onClick={handleAppendSystemSave}
                disabled={!appendSystemDirty || appendSystemSaving || appendSystemSavedOk}
                style={{
                  padding: "4px 14px", height: 28,
                  background: appendSystemSavedOk ? "#16a34a" : appendSystemSaving ? "var(--bg-panel)" : "var(--accent)",
                  border: "none", borderRadius: 6,
                  color: appendSystemSavedOk ? "#fff" : appendSystemSaving ? "var(--text-muted)" : "#fff",
                  cursor: (!appendSystemDirty || appendSystemSaving || appendSystemSavedOk) ? "default" : "pointer",
                  fontSize: 12, fontWeight: 600,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "background-color 0.2s ease, color 0.2s ease",
                  opacity: (!appendSystemDirty || appendSystemSaving || appendSystemSavedOk) ? 0.5 : 1,
                }}
              >
                {appendSystemSavedOk && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                <span>{appendSystemSavedOk ? t("Saved") : appendSystemSaving ? t("Saving...") : t("Save")}</span>
              </button>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0", lineHeight: 1.5 }}>
              {config?.append_system.enabled
                ? t("Appended to every new pi session's system prompt. Takes effect on new sessions.")
                : t("Disabled — new sessions will NOT load this file. Edit and save above to keep the content for when you re-enable it.")}
            </p>
            {/* APPEND_SYSTEM.md loader toggle — immediate-apply. Independent
                from the Save button above (which only writes file content).
                Mirrors the styling of the Clawd on Desk switch in Section 4. */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: "var(--text)" }}>
                {config?.append_system.enabled ? t("Loading on") : t("Loading off")}
              </span>
              <button
                onClick={handleAppendSystemEnabledToggle}
                style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: config?.append_system.enabled ? "var(--accent)" : "var(--bg-hover)",
                  border: "none", cursor: "pointer", position: "relative",
                  transition: "background 0.2s",
                }}
              >
                <span style={{
                  position: "absolute", top: 2,
                  left: config?.append_system.enabled ? 20 : 2,
                  width: 18, height: 18, borderRadius: 9,
                  background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  transition: "left 0.2s",
                }} />
              </button>
            </div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)",
              padding: "4px 8px", marginBottom: 10,
              background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 5,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {appendSystem?.path ?? "~/.pi/agent/APPEND_SYSTEM.md"}
              {appendSystem && !appendSystem.exists && (
                <span style={{ marginLeft: 8, color: "var(--text-dim)" }}>({t("file does not exist yet — saving will create it")})</span>
              )}
            </div>
            <textarea
              value={appendSystem?.content ?? ""}
              onChange={(e) => setAppendSystem((prev) => (prev ? { ...prev, content: e.target.value } : prev))}
              disabled={appendSystemLoading || !appendSystem}
              placeholder={appendSystemLoading ? t("Loading...") : t("Markdown content appended after the built-in system prompt.")}
              spellCheck={false}
              style={{
                width: "100%", height: 220, padding: "10px 12px", resize: "vertical",
                background: "var(--bg-panel)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text)", fontSize: 12,
                fontFamily: "var(--font-mono)", lineHeight: 1.55,
                outline: "none",
              }}
            />
          </div>

          {/* ── Section 4: Built-in Extensions ── */}
          <div data-settings-section="settings-section-clawd" style={{ marginBottom: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>{t("Clawd on Desk")}</h3>
              <button
                onClick={handleSave}
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
                onClick={handleClawdOnDeskToggle}
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

          {/* ── Section 5: Custom Tools (agent_todo, show_media, ask_user_questions) ── */}
          {/* Immediate-apply checkboxes, same shape as Section 6. */}
          {config && (
            <div data-settings-section="settings-section-custom-tools" style={{ marginBottom: 24, marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
                {t("Custom Tools")}
              </h3>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                {t("Enable or disable custom pi tools. Changes apply to sessions started after this point; running sessions keep their original tool set.")}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {CUSTOM_TOOLS_UI.map(({ id, labelKey }) => {
                  const checked = config.custom_tools.enabled.includes(id);
                  return (
                    <label
                      key={id}
                      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)" }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleCustomToolToggle(id)}
                        style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }}
                      />
                      <span>{t(labelKey)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Section 6: Right-side buttons ── */}
          {/* Immediate-apply section (no per-section Save button). Each
              checkbox toggle calls handleRightBarToggle, which updates local
              state + the global settings store + PUTs to /api/settings. */}
          {config && (
            <div data-settings-section="settings-section-right-bar" style={{ marginBottom: 24, marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
                {t("Right-side buttons")}
              </h3>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                {t("Choose which buttons appear in the right-side bar. Hidden buttons can still be opened from the command palette. Changes apply immediately.")}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {RIGHT_BAR_BUTTONS_UI.map(({ id, labelKey }) => {
                  const checked = config.right_side_bar[id] !== false;
                  return (
                    <label
                      key={id}
                      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--text)" }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleRightBarToggle(id)}
                        style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }}
                      />
                      <span>{t(labelKey)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div data-settings-section="settings-section-inbox-test">
            <InboxTestSection />
          </div>

          {/* ── Section 7: File preview limits ── */}
          {/* Per-kind MB caps. Renders FILE_VIEWER_UI rows; each row's
              onCommit dispatches to handleFileViewerLimitChange, which
              PUTs the whole PiWorkConfig and keeps modal isDirty=false.
              Already-open file tabs are not force-refetched — the new
              limit applies on the next read (Q9 decision). */}
          {config && (
            <div data-settings-section="settings-section-file-preview" style={{ marginBottom: 24, marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px 0" }}>
                {t("File preview limits")}
              </h3>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                {t("Maximum file size the preview pane will load. Audio and video are streamed with no size limit.")}
              </p>
              {FILE_VIEWER_UI.map(({ kind, labelKey }) => {
                const { min, max } = FILE_VIEWER_LIMITS[kind];
                return (
                  <FileViewerLimitRow
                    key={kind}
                    kind={kind}
                    label={t(labelKey)}
                    min={min}
                    max={max}
                    value={config.file_viewer.max_size_mb[kind]}
                    onCommit={(next) => handleFileViewerLimitChange(kind, next)}
                  />
                );
              })}
            </div>
          )}

          {/* ── Section 8: Typewriter phrases (chat input placeholder) ── */}
          {/* One phrase per line, per locale. Same shape as the Append
              System Prompt section: independent Save button that PUTs the
              whole PiWorkConfig and immediately publishes to the settings
              store so the chat input re-renders with the new phrases. */}
          {config && (
            <div data-settings-section="settings-section-typewriter" style={{ marginBottom: 24, marginTop: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>
                  {t("Typewriter phrases")}
                </h3>
                <button
                  onClick={handleTypewriterSave}
                  disabled={!typewriterDirty || typewriterSaving || typewriterSavedOk}
                  style={{
                    padding: "4px 14px", height: 28,
                    background: typewriterSavedOk ? "#16a34a" : typewriterSaving ? "var(--bg-panel)" : "var(--accent)",
                    border: "none", borderRadius: 6,
                    color: typewriterSavedOk ? "#fff" : typewriterSaving ? "var(--text-muted)" : "#fff",
                    cursor: (!typewriterDirty || typewriterSaving || typewriterSavedOk) ? "default" : "pointer",
                    fontSize: 12, fontWeight: 600,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    transition: "background-color 0.2s ease, color 0.2s ease",
                    opacity: (!typewriterDirty || typewriterSaving || typewriterSavedOk) ? 0.5 : 1,
                  }}
                >
                  {typewriterSavedOk && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  <span>{typewriterSavedOk ? t("Saved") : typewriterSaving ? t("Saving...") : t("Save")}</span>
                </button>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                {t("Custom phrases cycled in the empty chat input. One phrase per line. Empty lines are ignored. Leave both blank to use the bundled defaults.")}
              </p>
              {(["en", "zh"] as const).map((loc) => (
                <div key={loc} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px 0" }}>
                    {loc === "en" ? t("English phrases") : t("Chinese phrases")}
                  </div>
                  <textarea
                    value={typewriterDraft[loc]}
                    onChange={(e) => setTypewriterDraft((prev) => ({ ...prev, [loc]: e.target.value }))}
                    spellCheck={false}
                    placeholder={DEFAULT_TYPEWRITER_PHRASES[loc].join("\n")}
                    style={{
                      width: "100%", height: 140, padding: "8px 10px", resize: "vertical",
                      background: "var(--bg-panel)", border: "1px solid var(--border)",
                      borderRadius: 6, color: "var(--text)", fontSize: 12,
                      fontFamily: "var(--font-mono)", lineHeight: 1.55,
                      outline: "none",
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
