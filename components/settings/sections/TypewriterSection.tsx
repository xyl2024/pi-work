"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  DEFAULT_TYPEWRITER_PHRASES,
  parseTypewriterPhraseList,
} from "@/lib/shared/typewriter-phrases";
import type { Locale } from "@/lib/shared/i18n-dict";
import type { PiWorkConfig } from "@/lib/shared/config-types";

/**
 * Section 10: Typewriter phrases (chat input placeholder).
 *
 * Per-locale textareas (one phrase per line). The section owns its
 * own draft + original-draft state machines (parse-on-save dedupes
 * + trims via `parseTypewriterPhraseList`, matching the server-side
 * parser). On Save we run through the `apply` hook so the optimistic
 * update + rollback path is shared with the other immediate-apply
 * sections; on success we re-seed the drafts to the canonicalized
 * form so the textarea shows exactly what was persisted.
 */
export function TypewriterSection({
  config,
  apply,
  onDirtyChange,
}: {
  config: PiWorkConfig;
  apply: (computeNext: (prev: PiWorkConfig) => PiWorkConfig) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();

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
  // state).
  const typewriterSeededRef = useRef(false);
  useEffect(() => {
    if (typewriterSeededRef.current) return;
    const seeded: Record<Locale, string> = {
      en: config.typewriter_phrases.en.join("\n"),
      zh: config.typewriter_phrases.zh.join("\n"),
    };
    typewriterSeededRef.current = true;
    setTypewriterDraft(seeded);
    setOriginalTypewriterDraft(seeded);
  }, [config]);

  const typewriterDirty =
    typewriterDraft.en !== originalTypewriterDraft.en ||
    typewriterDraft.zh !== originalTypewriterDraft.zh;

  useEffect(() => {
    onDirtyChange?.(typewriterDirty);
  }, [typewriterDirty, onDirtyChange]);

  const handleTypewriterSave = useCallback(async () => {
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
      // apply() updates config + settingsStore + PUTs the whole
      // PiWorkConfig; on failure it rolls back and returns false.
      // We only re-seed the drafts to the canonicalized form on
      // success so the textarea shows exactly what was persisted.
      const ok = await apply((prev) => ({
        ...prev,
        typewriter_phrases: { en: nextEn, zh: nextZh },
      }));
      if (ok) {
        const reseeded: Record<Locale, string> = {
          en: nextEn.join("\n"),
          zh: nextZh.join("\n"),
        };
        setTypewriterDraft(reseeded);
        setOriginalTypewriterDraft(reseeded);
        setTypewriterSavedOk(true);
        setTimeout(() => setTypewriterSavedOk(false), 1500);
      }
    } finally {
      setTypewriterSaving(false);
    }
  }, [typewriterDraft, apply]);

  return (
    <div data-settings-section="settings-section-typewriter" style={{ marginBottom: 24, marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>
          {t("Typewriter phrases")}
        </h3>
        <button
          onClick={() => void handleTypewriterSave()}
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
            }}
          />
        </div>
      ))}
    </div>
  );
}