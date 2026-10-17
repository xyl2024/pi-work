"use client";

import { type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Tooltip } from "@/components/ui/Tooltip";
import { TruncatedText } from "@/components/ui/TruncatedText";
import { avatarPalette } from "@/lib/client/avatar-palette";
import type { Skill } from "@/lib/shared/skills";

/**
 * One skill rendered as a card in the panel's root grid.
 *
 * Card anatomy (matching the reference design):
 *   ┌───────────────────────────────────┐
 *   │ (A)  skill-name            [toggle]│
 *   │ description clamped to 2 lines     │
 *   └───────────────────────────────────┘
 *
 * The whole card is clickable and opens the skill detail page; the toggle
 * stops propagation (see ToggleSwitch) so it can be flipped in place. The
 * temporarily-still-mounted modal grid imports this same card.
 */

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
