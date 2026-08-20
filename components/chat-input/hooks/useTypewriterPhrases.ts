"use client";

import { useMemo } from "react";
import { useSettings } from "@/hooks/settingsStore";
import type { Locale } from "@/hooks/useI18n";
import { TYPEWRITER_PHRASES } from "../constants";

export interface UseTypewriterPhrasesResult {
  /** Resolved phrases list (configured by user, falling back to bundled defaults). */
  typewriterPhrases: string[];
  /** Master switch from settings (defaults to true so the first render
   *  before /api/settings responds preserves the pre-toggle behavior). */
  typewriterEffectEnabled: boolean;
  /** Content-signature key for the Typewriter: changes only when the phrases
   *  list's actual content changes (not just the array reference). A remount
   *  gives us a clean state reset for any reconfigure — without this, a
   *  same-length content edit could leave `text` containing partial chars
   *  from the previous phrase. The separator is the start-of-heading control
   *  char to avoid collisions with user input. */
  typewriterKey: string;
}

/**
 * Resolve the locale-aware typewriter phrases + master switch from the
 * settings store. Pure derived state — no side effects.
 */
export function useTypewriterPhrases(locale: Locale): UseTypewriterPhrasesResult {
  const settings = useSettings();
  // Pick the active locale's typewriter phrases from the settings store.
  // Falls back to the bundled defaults whenever the store hasn't loaded
  // yet (initial mount) or the user-supplied list is empty for this locale.
  const typewriterPhrases = useMemo(() => {
    const configured = settings?.typewriter_phrases?.[locale];
    if (Array.isArray(configured) && configured.length > 0) return configured;
    return TYPEWRITER_PHRASES[locale];
  }, [settings, locale]);
  // Master switch for the cycling animated placeholder.
  const typewriterEffectEnabled = settings?.typewriter_effect?.enabled ?? true;
  // Memoized so the join only recomputes when the phrases ref changes.
  const typewriterKey = useMemo(
    () => `${locale}${typewriterPhrases.join("")}`,
    [typewriterPhrases, locale],
  );
  return { typewriterPhrases, typewriterEffectEnabled, typewriterKey };
}