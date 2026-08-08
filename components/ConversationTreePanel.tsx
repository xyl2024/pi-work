"use client";

import { useEffect, useMemo, useRef } from "react";
import type { SessionEntry, SessionTreeNode } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import { Tooltip } from "./Tooltip";
import { ConversationTreeCard } from "./ConversationTreeCard";
import { buildConversationTree } from "@/lib/buildConversationTree";
import { layoutConversationTree } from "@/lib/conversationTreeLayout";
import type { LayoutCard } from "@/lib/conversationTreeLayout";

/** Pixels (pre-scale). */
const CARD_W = 200;
const CARD_H = 64;
const COL_GAP = 48;
const ROW_GAP = 36;
const SCALE = 0.85;

function formatRoundLabel(stats: { thinking: number; toolCalls: number }): string | null {
  const parts: string[] = [];
  if (stats.thinking > 0) parts.push(`${stats.thinking} 条思考`);
  if (stats.toolCalls > 0) parts.push(`${stats.toolCalls} 条工具调用`);
  if (parts.length === 0) return null;
  return parts.join(" ");
}

interface Props {
  /** The full session entries — used to look up the entry that a card represents for the tooltip / scroll. */
  entriesById: Map<string, SessionEntry>;
  /** True while the agent is streaming tokens. Drives auto-follow scroll. */
  isStreaming: boolean;
  /**
   * True for the *entire* agent turn (waiting_model / streaming / running_tools /
   * retrying), from agent_start to agent_end. We lock every card for this
   * whole window — switching branches mid-round would race the in-flight
   * response even during the non-streaming gaps between LLM calls.
   */
  agentRunning: boolean;
  /** Called when the user clicks a card; the parent (AppShell) decides whether to navigate_tree or scroll. */
  onCardClick: (card: LayoutCard) => void;
}

export function ConversationTreePanel({ entriesById, isStreaming, agentRunning, onCardClick }: Props) {
  const { t } = useI18n();
  const { branchTree, branchActiveLeafId } = useSessionUiState();

  const tree = useMemo(
    () => buildConversationTree(branchTree as SessionTreeNode[], branchActiveLeafId),
    [branchTree, branchActiveLeafId],
  );
  const layout = useMemo(
    () => layoutConversationTree(tree.cards),
    [tree.cards],
  );
  const hoveredRef = useRef<LayoutCard | null>(null);

  // Auto-follow: scroll the panel to keep the latest active card visible
  // while streaming, and only when the active leaf is the deepest one.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isStreaming) return;
    if (!branchActiveLeafId) return;
    const el = scrollRef.current?.querySelector(
      `[data-card-id="${branchActiveLeafId}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    // Only auto-scroll if the card is below the visible viewport.
    const parent = scrollRef.current;
    if (!parent) return;
    const elRect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    if (elRect.bottom > parentRect.bottom - 24) {
      el.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [branchActiveLeafId, isStreaming, layout.cards.length]);

  const handleClick = (card: LayoutCard) => {
    onCardClick(card);
  };
  const handleHover = (card: LayoutCard | null) => {
    hoveredRef.current = card;
  };

  if (layout.cards.length === 0) {
    const reason = branchTree.length === 0
      ? t("No active session")
      : t("Empty session");
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          color: "var(--text-muted)",
          fontSize: 12,
          textAlign: "center",
          fontStyle: "italic",
        }}
      >
        {reason}
      </div>
    );
  }

  const colPitch = CARD_W + COL_GAP;
  const rowPitch = CARD_H + ROW_GAP;
  const totalWidth = layout.widthCols * colPitch - COL_GAP;
  const totalHeight = layout.heightRows * rowPitch - ROW_GAP;

  // Build the SVG path for each edge.
  return (
    <div
      ref={scrollRef}
      style={{
        height: "100%",
        overflow: "auto",
        background: "var(--bg)",
        position: "relative",
      }}
    >
      <div
        style={{
          // The transformed inner container — origin top-left so the
          // page-level header (if any wraps this panel) doesn't get
          // scaled with the tree.
          transform: `scale(${SCALE})`,
          transformOrigin: "top left",
          width: totalWidth,
          height: totalHeight,
          padding: "12px 12px 24px 12px",
        }}
      >
        <div
          style={{
            position: "relative",
            width: totalWidth,
            height: totalHeight,
          }}
        >
          {/* SVG overlay for edges + edge labels */}
          <svg
            width={totalWidth}
            height={totalHeight}
            style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
          >
            {layout.edges.map((edge) => {
              const parent = layout.cards.find((c) => c.id === edge.fromId);
              const child = layout.cards.find((c) => c.id === edge.toId);
              if (!parent || !child) return null;
              const onActive =
                tree.activePathIds.has(parent.id) && tree.activePathIds.has(child.id);
              // The active leaf path is the ONLY indicator of the current
              // branch (cards themselves are uniform). Bump the active
              // stroke well above the inactive one so it reads at a glance.
              const stroke = onActive ? "var(--accent)" : "var(--text-dim)";
              const strokeWidth = onActive ? 2.5 : 1;
              const strokeOpacity = onActive ? 1 : 0.55;
              const px = parent.x * colPitch + CARD_W / 2;
              const py = parent.y * rowPitch + CARD_H;
              const cx = child.x * colPitch + CARD_W / 2;
              const cy = child.y * rowPitch;
              // Same column: straight vertical line.
              // Different column: down, jog horizontal, then down.
              let d: string;
              if (parent.x === child.x) {
                d = `M ${px} ${py} L ${cx} ${cy}`;
              } else {
                const midY = py + ROW_GAP / 2;
                d = `M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}`;
              }
              const label =
                edge.isUserToAssistant && edge.roundStats
                  ? formatRoundLabel(edge.roundStats)
                  : null;
              const labelY = (py + cy) / 2;
              return (
                <g key={`${edge.fromId}->${edge.toId}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeDasharray="4 4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {label && (
                    <g transform={`translate(${px + 8}, ${labelY})`}>
                      <rect
                        x={0}
                        y={-8}
                        width={label.length * 7 + 8}
                        height={16}
                        rx={4}
                        fill="var(--bg-panel)"
                        stroke={stroke}
                        strokeWidth={0.8}
                      />
                      <text
                        x={4}
                        y={3}
                        fontSize={9}
                        fontFamily="var(--font-mono)"
                        fill={onActive ? "var(--accent)" : "var(--text-muted)"}
                      >
                        {label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          {/* Card layer. The active leaf path is communicated solely via the
              edge strokes above — cards themselves are uniform (no per-card
              highlight/dim) so the only "lit vs unlit" signal is which line
              connects them. */}
          {layout.cards.map((card) => (
            <div
              key={card.id}
              data-card-id={card.id}
              style={{
                position: "absolute",
                left: card.x * colPitch,
                top: card.y * rowPitch,
              }}
            >
              <CardWithTooltip
                card={card}
                // Lock every card for the entire agent turn, not just the
                // streaming sub-window. The agent can be busy with tool
                // calls between LLM turns, and switching branches then
                // would race the in-flight response just the same.
                disabled={agentRunning}
                width={CARD_W}
                height={CARD_H}
                onClick={handleClick}
                onHover={handleHover}
                entriesById={entriesById}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface CardWithTooltipProps {
  card: LayoutCard;
  /** True while the agent is streaming — blocks the card's click. */
  disabled: boolean;
  width: number;
  height: number;
  onClick: (card: LayoutCard) => void;
  onHover: (card: LayoutCard | null) => void;
  entriesById: Map<string, SessionEntry>;
}

function CardWithTooltip({
  card,
  disabled,
  width,
  height,
  onClick,
  onHover,
  entriesById,
}: CardWithTooltipProps) {
  const entry = entriesById.get(card.id);
  const ts = entry?.timestamp ? new Date(entry.timestamp).toLocaleString() : "";
  const fullText =
    card.text.trim().length > 0
      ? card.text
      : (card.placeholder ?? "");
  const tooltip = (
    <div style={{ maxWidth: 280, whiteSpace: "pre-wrap" }}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
        {card.role === "user" ? "User" : "Assistant"} · {ts}
      </div>
      <div style={{ fontSize: 11 }}>{fullText}</div>
    </div>
  );
  return (
    <Tooltip content={tooltip} side="left">
      <ConversationTreeCard
        card={card}
        disabled={disabled}
        width={width}
        height={height}
        onClick={onClick}
        onHover={onHover}
      />
    </Tooltip>
  );
}