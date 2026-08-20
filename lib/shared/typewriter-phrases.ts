// Client-safe module for the chat-input typewriter phrases.
//
// Lives outside lib/config.ts because that file imports fs / os / js-yaml
// (server-only). The chat input is a "use client" component — it can only
// import types or pure constants from us, mirroring the lib/i18n-dict.ts
// pattern documented in AGENTS.md.
//
// The same default list is used both as:
//   1. The shipped fallback when ~/.pi-work/config.yaml has no
//      `typewriter_phrases` field (or it parses to something invalid).
//   2. The bundled defaults that PiWorkConfig.typewriter_phrases is
//      seeded with on first read.
//
// Parsing rules — fail-open: any time we're not sure what the user meant,
// fall back to the default list. An empty list is treated as "no phrases"
// which would break the Typewriter effect (it would loop forever picking
// phrases[0] === undefined), so empty inputs also fall back.

import type { Locale } from "@/lib/shared/i18n-dict";

/** Bundled default phrases used by the chat input typewriter. */
export const DEFAULT_TYPEWRITER_PHRASES: Record<Locale, string[]> = {
  en: [
    "Stay hungry, stay foolish. — Steve Jobs",
    "The only way out is through. — Robert Frost",
    "What we think, we become. — Buddha",
    "Simplicity is the ultimate sophistication. — Leonardo da Vinci",
    "The journey of a thousand miles begins with one step. — Lao Tzu",
    "It always seems impossible until it's done. — Nelson Mandela",
    "In the middle of difficulty lies opportunity. — Albert Einstein",
    "Imagination is more important than knowledge. — Albert Einstein",
    "The future depends on what you do today. — Mahatma Gandhi",
    "Well begun is half done. — Aristotle",
    "Do what you can, with what you have, where you are. — Theodore Roosevelt",
  ],
  zh: [
    "我思故我在。——笛卡尔",
    "知识就是力量。——培根",
    "学而不思则罔，思而不学则殆。——孔子",
    "千里之行，始于足下。——老子",
    "天行健，君子以自强不息。——《周易》",
    "路漫漫其修远兮，吾将上下而求索。——屈原",
    "生活不止眼前的苟且。——现代诗句",
    "凡是过去，皆为序章。——莎士比亚",
    "真正重要的东西，用眼睛是看不见的。——圣埃克苏佩里",
  ],
};

/**
 * Parse one locale's phrase list from arbitrary YAML-loaded input.
 * Returns the default list when input is missing / not an object / not an
 * array / empty. Used by the lib/config.ts reader to validate each
 * `typewriter_phrases.<locale>` field independently — if the user mangles
 * just one locale, the other one still loads.
 */
export function parseTypewriterPhraseList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.length === 0 ? fallback : out;
}

/**
 * Validate + normalize a full `typewriter_phrases` object. Each locale
 * falls back to its own default if its slot is missing or malformed, so
 * the user can leave just one locale configured and still see the other
 * fall back to the bundled defaults (rather than ending up with an empty
 * array breaking the Typewriter effect).
 */
export function parseTypewriterPhrases(
  raw: unknown,
  defaults: Record<Locale, string[]> = DEFAULT_TYPEWRITER_PHRASES,
): Record<Locale, string[]> {
  if (!raw || typeof raw !== "object") return { en: [...defaults.en], zh: [...defaults.zh] };
  const obj = raw as Record<string, unknown>;
  return {
    en: parseTypewriterPhraseList(obj.en, defaults.en),
    zh: parseTypewriterPhraseList(obj.zh, defaults.zh),
  };
}