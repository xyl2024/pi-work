"use client";

/**
 * GrokBotStage — the always-on companion in the top of the left sidebar,
 * wrapped in the shared collapsible SidebarSection (same pattern as
 * Sessions / Explorer).
 *
 * Expanded: a small living GrokBot (gaze follows the pointer, random blinks,
 * per-state expression cadence) that opens the full lab modal when clicked.
 * The gear button in the section header does the same. Collapsing unmounts
 * the stage entirely (SidebarSection's lifecycle), pausing the animation
 * loop until re-expanded.
 */

import { useRef, useState } from "react";
import { GrokBot, type GrokBotHandle } from "./GrokBot";
import { useGrokbotConfig, setGrokbotConfig } from "@/lib/grokbot-store";
import { GROKBOT_EXPRESSIONS } from "@/lib/grokbot-data";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "./Tooltip";
import { SidebarSection } from "./SidebarSection";

interface Props {
  onOpenLab: () => void;
}

export function GrokBotStage({ onOpenLab }: Props) {
  const { t } = useI18n();
  const botRef = useRef<GrokBotHandle>(null);
  const [open, setOpen] = useState(true);
  const config = useGrokbotConfig();

  // Clicking the bot itself switches to a random (different) expression.
  const handleBotClick = () => {
    let next = Math.floor(Math.random() * GROKBOT_EXPRESSIONS.length);
    if (next === config.expression && GROKBOT_EXPRESSIONS.length > 1) {
      next = (next + 1) % GROKBOT_EXPRESSIONS.length;
    }
    setGrokbotConfig({ expression: next });
  };

  return (
    <SidebarSection
      title="Pi Bot"
      open={open}
      onToggle={() => setOpen((v) => !v)}
      grow={0}
      actions={
        <Tooltip content={t("Pi Bot Lab")}>
          <button
            type="button"
            onClick={onOpenLab}
            aria-label={t("Pi Bot Lab")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0,
              background: "none", border: "none",
              color: "var(--text-dim)", cursor: "pointer",
              borderRadius: 5, flexShrink: 0,
              transition: "color 0.12s, background 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-dim)";
              e.currentTarget.style.background = "none";
            }}
          >
            <svg
              width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Tooltip>
      }
    >
      <div
        onClick={handleBotClick}
        style={{ cursor: "pointer", userSelect: "none", padding: "4px 0 6px" }}
      >
        <GrokBot ref={botRef} size={104} />
      </div>
    </SidebarSection>
  );
}
