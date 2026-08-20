"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useToast } from "@/components/Toast";
import type { PiWorkConfig } from "@/lib/config";

/**
 * Section 3: Append System Prompt (~/.pi/agent/APPEND_SYSTEM.md).
 *
 * Two independent controls share this section:
 *
 * 1. **Loader toggle** (immediate-apply via the `apply` prop) — flips
 *    `PiWorkConfig.append_system.enabled`. Changes only take effect on
 *    sessions started AFTER the PUT (rpc-manager reads the flag once
 *    per session start).
 * 2. **Textarea + Save** — edits the file content on disk via the
 *    separate `/api/append-system` PUT endpoint. Has its own
 *    dirty/saving/savedOk state machine since the loader toggle and
 *    the content edit are conceptually separate (you can edit the
 *    file while the loader is off; the change just won't take effect
 *    until you turn it back on).
 */
export function AppendSystemSection({
  config,
  apply,
  onDirtyChange,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [appendSystem, setAppendSystem] = useState<{ content: string; path: string; exists: boolean } | null>(null);
  const [originalAppendSystem, setOriginalAppendSystem] = useState<string>("");
  const [appendSystemLoading, setAppendSystemLoading] = useState(true);
  const [appendSystemSaving, setAppendSystemSaving] = useState(false);
  const [appendSystemSavedOk, setAppendSystemSavedOk] = useState(false);

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

  const appendSystemDirty = !!appendSystem && appendSystem.content !== originalAppendSystem;

  useEffect(() => {
    onDirtyChange?.(appendSystemDirty);
  }, [appendSystemDirty, onDirtyChange]);

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

  return (
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
        {config.append_system.enabled
          ? t("Appended to every new pi session's system prompt. Takes effect on new sessions.")
          : t("Disabled — new sessions will NOT load this file. Edit and save above to keep the content for when you re-enable it.")}
      </p>
      {/* APPEND_SYSTEM.md loader toggle — immediate-apply. Independent
          from the Save button above (which only writes file content). */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>
          {config.append_system.enabled ? t("Loading on") : t("Loading off")}
        </span>
        <button
          onClick={() => {
            void apply((prev) => ({
              ...prev,
              append_system: { enabled: !prev.append_system.enabled },
            }));
          }}
          style={{
            width: 40, height: 22, borderRadius: 11,
            background: config.append_system.enabled ? "var(--accent)" : "var(--bg-hover)",
            border: "none", cursor: "pointer", position: "relative",
            transition: "background 0.2s",
          }}
        >
          <span style={{
            position: "absolute", top: 2,
            left: config.append_system.enabled ? 20 : 2,
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
  );
}