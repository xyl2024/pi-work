"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionTreeNode } from "@/lib/shared/types";
import { useI18n } from "@/hooks/useI18n";
import { useSessionUiState } from "@/hooks/sessionUiStore";
import { ConversationTreeCard } from "./ConversationTreeCard";
import { BranchMessageViewer } from "./BranchMessageViewer";
import { IconButton } from "../ui/IconButton";
import { MaximizeIcon as FitIcon, MinusIcon, PlusIcon } from "../ui/icons";
import { buildConversationTree } from "@/lib/shared/buildConversationTree";
import { layoutConversationTree } from "@/lib/shared/conversationTreeLayout";
import type { LayoutCard } from "@/lib/shared/conversationTreeLayout";
import {
  clampCanvasScale,
  computeZoomAnchor,
  DEFAULT_CANVAS_SCALE,
  fitCanvasScale,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  scrollForAnchor,
  type ZoomAnchor,
} from "@/lib/shared/canvasZoom";
import {
  hashString,
  roughPolyline,
  roughRect,
  sketchRotateDeg,
} from "@/lib/client/rough";

const CARD_W = 200;
const CARD_H = 64;
const COL_GAP = 72;
const ROW_GAP = 54;

const PAD = 24;
const ZOOM_STEP = 1.2;

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
  isStreaming: boolean;
  agentRunning: boolean;
  onCardClick: (card: LayoutCard) => void;
}

export function ConversationTreePanel({ isStreaming, agentRunning, onCardClick }: Props) {
  const { t } = useI18n();
  const { branchTree, branchActiveLeafId } = useSessionUiState();
  const [zoomEntryId, setZoomEntryId] = useState<string | null>(null);

  const tree = useMemo(
    () => buildConversationTree(branchTree as SessionTreeNode[], branchActiveLeafId),
    [branchTree, branchActiveLeafId],
  );
  const layout = useMemo(
    () => layoutConversationTree(tree.cards),
    [tree.cards],
  );
  const cardSketch = useMemo(() => {
    const map = new Map<string, { angle: number; borderPaths: string[] }>();
    for (const c of layout.cards) {
      map.set(c.id, {
        angle: sketchRotateDeg(c.id),
        borderPaths: roughRect(1, 1, CARD_W - 2, CARD_H - 2, hashString(`${c.id}:border`)),
      });
    }
    return map;
  }, [layout.cards]);
  const hoveredRef = useRef<LayoutCard | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const colPitch = CARD_W + COL_GAP;
  const rowPitch = CARD_H + ROW_GAP;
  const totalWidth = layout.widthCols * colPitch - COL_GAP;
  const totalHeight = layout.heightRows * rowPitch - ROW_GAP;
  const canvasW = totalWidth + PAD * 2;
  const canvasH = totalHeight + PAD * 2;

  const [scale, setScale] = useState(DEFAULT_CANVAS_SCALE);
  const scaleRef = useRef(scale);
  const pendingAnchor = useRef<ZoomAnchor | null>(null);

  const applyScale = useCallback((next: number, pointer?: { x: number; y: number }) => {
    const clamped = clampCanvasScale(next);
    const prev = scaleRef.current;
    if (Math.abs(clamped - prev) < 0.0001) return;
    const el = scrollRef.current;
    if (!el) {
      scaleRef.current = clamped;
      setScale(clamped);
      return;
    }
    const rect = el.getBoundingClientRect();
    pendingAnchor.current = computeZoomAnchor({
      currentScale: prev,
      scroll: { left: el.scrollLeft, top: el.scrollTop },
      viewport: { width: el.clientWidth, height: el.clientHeight },
      pointer: pointer ? { x: pointer.x - rect.left, y: pointer.y - rect.top } : undefined,
      pending: pendingAnchor.current,
    });
    scaleRef.current = clamped;
    setScale(clamped);
  }, []);

  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    const el = scrollRef.current;
    if (!anchor || !el) return;
    pendingAnchor.current = null;
    const scroll = scrollForAnchor(anchor, scale);
    el.scrollLeft = scroll.left;
    el.scrollTop = scroll.top;
  }, [scale]);

  const fitToView = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = fitCanvasScale(
      { width: canvasW, height: canvasH },
      { width: el.clientWidth, height: el.clientHeight },
    );
    if (Math.abs(next - scaleRef.current) < 0.0001) {
      el.scrollTo({ left: 0, top: 0 });
      return;
    }
    scaleRef.current = next;
    pendingAnchor.current = { contentX: 0, contentY: 0, mx: 0, my: 0 };
    setScale(next);
  }, [canvasW, canvasH]);

  const cardCount = layout.cards.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1;
      const factor = Math.exp(-event.deltaY * unit * 0.0015);
      applyScale(scaleRef.current * factor, { x: event.clientX, y: event.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyScale, cardCount]);

  const panRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);

  const handlePanStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.pointerType === "touch") return;
    const el = scrollRef.current;
    if (!el) return;
    if ((event.target as HTMLElement).closest("[data-card-id]")) return;
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const handlePanMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const el = scrollRef.current;
    if (!pan || !el) return;
    el.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    el.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  };
  const handlePanEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    panRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => {
    if (!isStreaming) return;
    if (!branchActiveLeafId) return;
    const el = scrollRef.current?.querySelector(
      `[data-card-id="${branchActiveLeafId}"]`,
    ) as HTMLElement | null;
    if (!el) return;
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

  return (
    <div style={{ height: "100%", position: "relative", overflow: "hidden" }}>
      <div
        ref={scrollRef}
        onPointerDown={handlePanStart}
        onPointerMove={handlePanMove}
        onPointerUp={handlePanEnd}
        onPointerCancel={handlePanEnd}
        style={{
          height: "100%",
          overflow: "auto",
          position: "relative",
          cursor: panning ? "grabbing" : "grab",
          userSelect: panning ? "none" : undefined,
          backgroundColor: "var(--bg)",
          backgroundImage:
            "radial-gradient(color-mix(in srgb, var(--text-dim) 22%, transparent) 0.7px, transparent 0.8px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div aria-hidden style={{ width: canvasW * scale, height: canvasH * scale }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: canvasW,
            height: canvasH,
            padding: PAD,
            boxSizing: "border-box",
          }}
        >
        <div
          style={{
            position: "relative",
            width: totalWidth,
            height: totalHeight,
          }}
        >
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
              const touchesCompaction = parent.role === "compaction" || child.role === "compaction";
              const stroke = onActive ? "var(--accent)" : "var(--text-dim)";
              const strokeWidth = onActive ? 2.5 : 1;
              const strokeOpacity = onActive ? 1 : 0.55;
              const px = parent.x * colPitch + CARD_W / 2;
              const py = parent.y * rowPitch + CARD_H;
              const cx = child.x * colPitch + CARD_W / 2;
              const cy = child.y * rowPitch;
              let labelX: number;
              let labelY: number;
              let points: [number, number][];
              if (parent.x === child.x) {
                points = [[px, py], [cx, cy]];
                labelX = px;
                labelY = (py + cy) / 2;
              } else {
                const midY = py + ROW_GAP / 2;
                points = [[px, py], [px, midY], [cx, midY], [cx, cy]];
                labelX = (px + cx) / 2;
                labelY = midY;
              }
              const d = roughPolyline(points, hashString(`${edge.fromId}->${edge.toId}`));
              const label =
                edge.isUserToAssistant && edge.roundStats
                  ? formatRoundLabel(edge.roundStats, t)
                  : null;
              const chipH = 14;
              const labelRotate = sketchRotateDeg(`${edge.fromId}->${edge.toId}:label`, 3.5);
              const flowing = agentRunning && onActive;
              return (
                <g key={`${edge.fromId}->${edge.toId}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeDasharray={flowing ? "3 9" : touchesCompaction ? "2 6" : "4 4"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={flowing ? "tree-edge-flow" : undefined}
                  />
                  {label && (
                    <g transform={`rotate(${labelRotate.toFixed(2)} ${labelX} ${labelY})`}>
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
          {layout.cards.map((card) => {
            const sketch = cardSketch.get(card.id);
            return (
              <div
                key={card.id}
                data-card-id={card.id}
                style={{
                  position: "absolute",
                  left: card.x * colPitch,
                  top: card.y * rowPitch,
                  transform: `rotate(${sketch?.angle.toFixed(2) ?? 0}deg)`,
                }}
              >
                {sketch && (
                  <svg
                    width={CARD_W}
                    height={CARD_H}
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 2,
                      pointerEvents: "none",
                    }}
                  >
                    {sketch.borderPaths.map((d, i) => (
                      <path
                        key={i}
                        d={d}
                        fill="none"
                        stroke={
                          card.role === "user"
                            ? "rgba(99, 102, 241, 0.55)"
                            : card.role === "compaction"
                              ? "var(--accent)"
                              : "var(--border)"
                        }
                        strokeWidth={card.role === "compaction" ? 1.4 : 1.1}
                        strokeDasharray={card.role === "compaction" ? "4 3" : undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                  </svg>
                )}
                <ConversationTreeCard
                  card={card}
                  disabled={agentRunning}
                  width={CARD_W}
                  height={CARD_H}
                  onClick={handleClick}
                  onHover={handleHover}
                  onZoom={handleZoom}
                />
              </div>
            );
          })}
        </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 10,
          bottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: 3,
          borderRadius: 999,
          background: "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
          border: "1px solid var(--border)",
          boxShadow: "0 2px 10px color-mix(in srgb, #000 16%, transparent)",
          backdropFilter: "blur(6px)",
          zIndex: 4,
        }}
      >
        <IconButton
          label={t("Zoom out")}
          size="xs"
          disabled={scale <= MIN_CANVAS_SCALE + 1e-6}
          onClick={() => applyScale(scaleRef.current / ZOOM_STEP)}
        >
          <MinusIcon />
        </IconButton>
        <button
          type="button"
          onClick={() => applyScale(1)}
          title={t("Reset zoom to 100%")}
          style={{
            minWidth: 40,
            padding: "2px 4px",
            background: "transparent",
            border: "none",
            borderRadius: 4,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          {Math.round(scale * 100)}%
        </button>
        <IconButton
          label={t("Zoom in")}
          size="xs"
          disabled={scale >= MAX_CANVAS_SCALE - 1e-6}
          onClick={() => applyScale(scaleRef.current * ZOOM_STEP)}
        >
          <PlusIcon />
        </IconButton>
        <span
          aria-hidden
          style={{ width: 1, height: 14, background: "var(--border)", margin: "0 2px" }}
        />
        <IconButton label={t("Fit to view")} size="xs" onClick={fitToView}>
          <FitIcon />
        </IconButton>
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
