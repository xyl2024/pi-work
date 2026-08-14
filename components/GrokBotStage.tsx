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

import { useEffect, useMemo, useRef, useState } from "react";
import { GrokBot, type GrokBotHandle } from "./GrokBot";
import { useGrokbotConfig, setGrokbotConfig } from "@/lib/grokbot-store";
import { GROKBOT_EXPRESSIONS } from "@/lib/grokbot-data";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "./Tooltip";
import { SidebarSection } from "./SidebarSection";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import { useAgentStatusState } from "@/lib/agent-status-store";

/**
 * Coarse 5-state mapping from agent signals → bot stateKey. Priority is
 * top-down: a pending permission beats an in-flight turn beats an idle
 * turn. `idle` is the only default and must always be a valid pool key
 * (see GROKBOT_POOLS in grokbot-data).
 */
type BotStatus = "idle" | "thinking" | "working" | "surprised" | "sad";

interface Props {
  onOpenLab: () => void;
  /**
   * Active session id, when one is selected. The bot only mirrors agent
   * state when this is set; otherwise it stays on whatever the user
   * manually picked (Lab modal, click-to-randomize) so the sidebar bot
   * doesn't get yanked around while the user is browsing sessions.
   */
  selectedSessionId?: string | null;
}

export function GrokBotStage({ onOpenLab, selectedSessionId }: Props) {
  const { t } = useI18n();
  const botRef = useRef<GrokBotHandle>(null);
  const [open, setOpen] = useState(true);
  const config = useGrokbotConfig();
  const ui = useSessionUiState();
  const agentStatus = useAgentStatusState();

  // Clicking the bot itself switches to a random (different) expression.
  const handleBotClick = () => {
    let next = Math.floor(Math.random() * GROKBOT_EXPRESSIONS.length);
    if (next === config.expression && GROKBOT_EXPRESSIONS.length > 1) {
      next = (next + 1) % GROKBOT_EXPRESSIONS.length;
    }
    setGrokbotConfig({ expression: next });
  };

  // Derive the target stateKey from agent signals. Priority (high→low):
  //   permission pending → surprised
  //   lastError sticky   → sad
  //   isStreaming        → thinking
  //   agentRunning       → working (tool running between LLM turns)
  //   otherwise          → idle
  // Only runs the effect below when an active session is selected.
  const botStatus: BotStatus = useMemo(() => {
    if (agentStatus.hasPendingPermission) return "surprised";
    if (agentStatus.lastError) return "sad";
    if (ui.isStreaming) return "thinking";
    if (ui.agentRunning) return "working";
    return "idle";
  }, [agentStatus.hasPendingPermission, agentStatus.lastError, ui.isStreaming, ui.agentRunning]);

  // Sync the derived status into the grokbot store. Skipped when no
  // session is active so the user's manual picks (Lab, click) aren't
  // clobbered by idle. The store's own cadence will pick a fresh
  // expression from the new state's pool after GROKBOT_EXPR_CADENCE
  // milliseconds, so we don't need to touch `expression` here.
  useEffect(() => {
    if (!selectedSessionId) return;
    if (config.stateKey === botStatus) return;
    setGrokbotConfig({ stateKey: botStatus });
    // config.stateKey intentionally omitted: re-syncing to the same
    // status is a no-op above; including it would loop on every store
    // tick (grokbot-store emits on cadence-driven expression swaps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, botStatus]);

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
