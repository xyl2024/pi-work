"use client";

/**
 * Deterministic pastel palette for a name-initial avatar.
 *
 * Shared by the card grids that draw one (skills, MCP entries, models) so a
 * row always gets the same colour for the same name. Purely cosmetic.
 */

const AVATAR_PALETTES: { bg: string; fg: string }[] = [
  { bg: "rgba(99,102,241,0.14)", fg: "#6366f1" },
  { bg: "rgba(20,184,166,0.14)", fg: "#0d9488" },
  { bg: "rgba(244,114,182,0.16)", fg: "#db2777" },
  { bg: "rgba(245,158,11,0.16)", fg: "#d97706" },
  { bg: "rgba(59,130,246,0.14)", fg: "#2563eb" },
  { bg: "rgba(168,85,247,0.16)", fg: "#9333ea" },
  { bg: "color-mix(in srgb, var(--success) 14%, transparent)", fg: "var(--success)" },
  { bg: "color-mix(in srgb, var(--error) 14%, transparent)", fg: "var(--error)" },
];

export function avatarPalette(name: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
}
