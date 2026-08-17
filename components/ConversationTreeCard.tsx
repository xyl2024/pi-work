"use client";

import { useState } from "react";
import type { LayoutCard } from "@/lib/conversationTreeLayout";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  card: LayoutCard;
  /** True while the agent is streaming — disables the card's click. */
  disabled: boolean;
  /** Pixels for the card box. The whole tree is scaled by its parent. */
  width: number;
  height: number;
  onClick: (card: LayoutCard) => void;
  onHover: (card: LayoutCard | null) => void;
  /** Open the full-branch preview modal for this card's entry. */
  onZoom: (card: LayoutCard) => void;
}

/**
 * Preview text for the card. Whitespace (spaces + newlines) is collapsed
 * away — the card is a tiny badge, and stripping whitespace helps the
 * 3-line clamp render readably. Empty `card.text` is valid (renders an
 * empty card).
 */
function previewText(card: LayoutCard): string {
  if (card.role === "compaction") {
    // Compact divider — show the kernel's "[compaction] compacted from
    // N tokens" line so users can spot the divider at a glance.
    const n = card.compaction?.tokensBefore ?? 0;
    const formatted = n.toLocaleString();
    return `[compaction] ${formatted} tokens`.trim();
  }
  return card.text.replace(/\s+/g, "");
}

export function ConversationTreeCard({
  card,
  disabled,
  width,
  height,
  onClick,
  onHover,
  onZoom,
}: Props) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const isUser = card.role === "user";
  const isCompaction = card.role === "compaction";
  // The crisp CSS border is deliberately omitted — the sketchy double-
  // stroked border is drawn by the panel's SVG overlay (lib/rough.ts).
  const background = isUser
    ? "rgba(99, 102, 241, 0.08)"
    : isCompaction
      ? "color-mix(in srgb, var(--accent) 10%, var(--bg-panel))"
      : "var(--bg-panel)";

  const displayText = previewText(card);

  return (
    <div
      onMouseEnter={() => {
        setHovered(true);
        onHover(card);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHover(null);
      }}
      onFocus={() => {
        setHovered(true);
        onHover(card);
      }}
      onBlur={() => {
        setHovered(false);
        onHover(null);
      }}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        background,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.12s",
        color: "var(--text)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => onClick(card)}
        disabled={disabled}
        aria-disabled={disabled}
        style={{
          // The actual clickable surface — fills the wrapper. The zoom
          // button sits on top via a separate sibling so it can capture
          // clicks without triggering the card's navigate.
          position: "absolute",
          inset: 0,
          padding: "8px 10px",
          background: "transparent",
          border: "none",
          borderRadius: "inherit",
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "center",
          overflow: "hidden",
          font: "inherit",
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            lineHeight: "14px",
            color: "var(--text)",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            wordBreak: "break-word",
          }}
        >
          {displayText}
        </span>
      </button>
      {/* Bottom-right corner: image chip with count */}
      {card.imageCount > 0 && (
        <span
          aria-label={`${card.imageCount} images`}
          style={{
            position: "absolute",
            right: 6,
            bottom: 5,
            display: "flex",
            alignItems: "center",
            gap: 3,
            fontSize: 10,
            color: "var(--text-dim)",
            pointerEvents: "none",
          }}
        >
          <svg
            width={11}
            height={11}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
          <span>×{card.imageCount}</span>
        </span>
      )}
      {/* Top-right corner: zoom button — fades in on hover. Sits above the
          card surface (z-index 2) and stops propagation so clicking the
          button never triggers the card's navigate behavior. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onZoom(card);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        disabled={disabled}
        aria-label={t("Expand card to view full message")}
        title={t("Expand card to view full message")}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = isUser ? "rgba(99,102,241,0.55)" : "var(--accent)";
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isUser ? "rgba(99,102,241,0.4)" : "var(--bg-hover)";
          e.currentTarget.style.color = isUser ? "#c7d2fe" : "var(--text)";
        }}
        style={{
          position: "absolute",
          top: 3,
          right: 3,
          width: 20,
          height: 20,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isUser ? "rgba(99,102,241,0.4)" : "var(--bg-hover)",
          color: isUser ? "#c7d2fe" : "var(--text)",
          border: "none",
          borderRadius: 4,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: hovered && !disabled ? 1 : 0,
          pointerEvents: hovered && !disabled ? "auto" : "none",
          transition: "opacity 0.12s, background 0.12s, color 0.12s",
          zIndex: 2,
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
    </div>
  );
}
