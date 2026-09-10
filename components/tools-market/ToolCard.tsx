"use client";

import { type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { avatarPalette } from "../settings/skills-config/SkillCard";
import { TruncatedText } from "../settings/skills-config/TruncatedText";
import type { ToolMarketDefinition } from "@/lib/shared/tools-market";

/**
 * One tool rendered as a card in the Tool Market grid, mirroring the
 * SkillsConfig `SkillCard` (round initial-letter avatar + bold name + clamped
 * description) so the two browsers read as the same kind of object.
 *
 * Card anatomy:
 *   ┌───────────────────────────────────┐
 *   │ (A)  tool-name                    │
 *   │      tool_id                      │
 *   │ description clamped to 2 lines    │
 *   └───────────────────────────────────┘
 *
 * The whole card is clickable and opens the tool detail page.
 */

const CLAMP_STYLE: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

export function ToolCard({ tool, onOpen }: { tool: ToolMarketDefinition; onOpen: () => void }) {
  const { t } = useI18n();
  const palette = avatarPalette(tool.id);
  const initial = (tool.name.trim()[0] ?? "?").toUpperCase();

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
        transition: "border-color 0.12s, box-shadow 0.12s, background 0.12s",
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
          text={t(tool.name)}
          side="bottom"
          always
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        />
      </div>

      <TruncatedText
        text={tool.id}
        side="bottom"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-dim)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      />

      <TruncatedText
        text={t(tool.description)}
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
