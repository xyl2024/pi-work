"use client";

import { type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Tooltip } from "@/components/ui/Tooltip";
import { TruncatedText } from "./TruncatedText";
import type { Skill } from "./types";

/**
 * One skill rendered as a card in the SkillsConfig grid.
 *
 * Card anatomy (matching the reference design):
 *   ┌───────────────────────────────────┐
 *   │ (A)  skill-name            [toggle]│
 *   │ description clamped to 2 lines     │
 *   └───────────────────────────────────┘
 *
 * The whole card is clickable and opens the skill detail page; the toggle
 * stops propagation (see ToggleSwitch) so it can be flipped in place.
 */

// Pastel palettes used for the initial-letter avatar, picked deterministically
// from the skill name so a skill always gets the same color.
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

const CLAMP_STYLE: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

export function SkillCard({
  skill,
  onOpen,
  onToggle,
  toggleLoading,
}: {
  skill: Skill;
  onOpen: () => void;
  onToggle: (disableModelInvocation: boolean) => void;
  toggleLoading: boolean;
}) {
  const { t } = useI18n();
  const palette = avatarPalette(skill.name);
  const frontmatterLocked = skill.frontmatterDisabled === true;
  const initial = (skill.name.trim()[0] ?? "?").toUpperCase();
  const description = skill.description || t("No description");

  const toggleNode = (
    <ToggleSwitch
      size="sm"
      on={!skill.disableModelInvocation}
      disabled={toggleLoading || frontmatterLocked}
      onChange={(next) => onToggle(!next)}
      label={skill.disableModelInvocation ? t("Enable") : t("Disable")}
    />
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: 12,
        cursor: "pointer",
        transition: "border-color 0.12s, box-shadow 0.12s, background 0.12s, transform 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-panel)";
        e.currentTarget.style.borderColor = "var(--text-dim)";
        e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: palette.bg,
            color: palette.fg,
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {initial}
        </span>
        <TruncatedText
          text={skill.name}
          side="bottom"
          always
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            color: skill.disableModelInvocation ? "var(--text-dim)" : "var(--text)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        />
        <span style={{ display: "inline-flex" }}>
          {frontmatterLocked ? (
            <Tooltip
              content={t("Locked by SKILL.md frontmatter (disable-model-invocation)")}
              side="top"
            >
              <span style={{ display: "inline-flex" }}>{toggleNode}</span>
            </Tooltip>
          ) : (
            toggleNode
          )}
        </span>
      </div>
      <TruncatedText
        text={description}
        side="bottom"
        style={{
          ...CLAMP_STYLE,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "var(--text-muted)",
          minHeight: 38,
        }}
      />
    </div>
  );
}
