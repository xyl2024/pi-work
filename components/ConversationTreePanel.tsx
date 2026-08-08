"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionTreeNode } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import { ConversationTreeCard } from "./ConversationTreeCard";
import { BranchMessageViewer } from "./BranchMessageViewer";
import { buildConversationTree } from "@/lib/buildConversationTree";
import { layoutConversationTree } from "@/lib/conversationTreeLayout";
import type { LayoutCard } from "@/lib/conversationTreeLayout";

/** Pixels (pre-scale). */
const CARD_W = 200;
const CARD_H = 64;
const COL_GAP = 72;
const ROW_GAP = 54;
const SCALE = 0.85;

function formatRoundLabel(
  stats: { thinking: number; toolCalls: number },
  t: (key: string) => string,
): { text: string; width: number } | null {
  const parts: string[] = [];
  if (stats.thinking > 0) parts.push(`${stats.thinking} ${t("thoughts")}`);
  if (stats.toolCalls > 0) parts.push(`${stats.toolCalls} ${t("tool calls")}`);
  if (parts.length === 0) return null;
  const text = parts.join(" ");
  return { text, width: estimateLabelWidth(text) };
}

/**
 * Pixel-width estimate for the round label at fontSize 9, var(--font-mono).
 * CJK glyphs are ~9px wide; digits ~5.5px; spaces ~3px. The +16 budget
 * leaves room for 8px horizontal padding on each side of the chip rect.
 */
function estimateLabelWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) {
      width += 9;
    } else if (ch === " ") {
      width += 3;
    } else {
      width += 5.5;
    }
  }
  return width + 16;
}

interface Props {
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

export function ConversationTreePanel({ isStreaming, agentRunning, onCardClick }: Props) {
  const { t } = useI18n();
  const { branchTree, branchActiveLeafId } = useSessionUiState();
  // When set, opens the full-branch preview modal for the clicked card's
  // entry. The viewer reads `branchTree` itself, so the panel stays
  // stateless about branch content.
  const [zoomEntryId, setZoomEntryId] = useState<string | null>(null);

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
  const handleZoom = (card: LayoutCard) => {
    setZoomEntryId(card.id);
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
          padding: "24px 24px 48px 24px",
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
              let labelX: number;
              let labelY: number;
              if (parent.x === child.x) {
                d = `M ${px} ${py} L ${cx} ${cy}`;
                // Center the chip on the vertical line at its midpoint.
                labelX = px;
                labelY = (py + cy) / 2;
              } else {
                const midY = py + ROW_GAP / 2;
                d = `M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}`;
                // Park the chip on the horizontal jog so it doesn't fight
                // the right-angle bends.
                labelX = (px + cx) / 2;
                labelY = midY;
              }
              const label =
                edge.isUserToAssistant && edge.roundStats
                  ? formatRoundLabel(edge.roundStats, t)
                  : null;
              const chipH = 14;
              // While the agent is working, the active branch's connector
              // animates: dashes march from the parent card (start point)
              // toward the child card (end point). See .tree-edge-flow.
              const flowing = agentRunning && onActive;
              return (
                <g key={`${edge.fromId}->${edge.toId}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeDasharray={flowing ? "3 9" : "4 4"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={flowing ? "tree-edge-flow" : undefined}
                  />
                  {label && (
                    <g>
                      {/* Background pill that breaks the line so the label
                          reads as a chip *on* the connector (not a label
                          floating over the line). fill = panel bg → the
                          dashed line "passes behind" the chip. */}
                      <rect
                        x={labelX - label.width / 2}
                        y={labelY - chipH / 2}
                        width={label.width}
                        height={chipH}
                        rx={chipH / 2}
                        ry={chipH / 2}
                        fill="var(--bg)"
                      />
                      <text
                        x={labelX}
                        y={labelY + 3}
                        fontSize={9}
                        fontFamily="var(--font-mono)"
                        fill={onActive ? "var(--accent)" : "var(--text-muted)"}
                        textAnchor="middle"
                      >
                        {label.text}
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
              <ConversationTreeCard
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
                onZoom={handleZoom}
              />
            </div>
          ))}
        </div>
      </div>
      {zoomEntryId && (
        <BranchMessageViewer
          entryId={zoomEntryId}
          branchTree={branchTree as SessionTreeNode[]}
          onClose={() => setZoomEntryId(null)}
        />
      )}
    </div>
  );
}
