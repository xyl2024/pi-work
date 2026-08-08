"use client";

import type { LayoutCard } from "@/lib/conversationTreeLayout";

interface Props {
  card: LayoutCard;
  /** True when this card's entry id is on the active leaf path. */
  active: boolean;
  /** True when the card is NOT on the active path (used to dim non-active branches). */
  dimmed: boolean;
  /** True when this is the user card of the round currently being streamed. */
  streaming: boolean;
  /** True while the agent is streaming — disables the card's click. */
  disabled: boolean;
  /** Pixels for the card box. The whole tree is scaled by its parent. */
  width: number;
  height: number;
  onClick: (card: LayoutCard) => void;
  onHover: (card: LayoutCard | null) => void;
}

const PLACEHOLDER_OPACITY = 0.7;

export function ConversationTreeCard({
  card,
  active,
  dimmed,
  streaming,
  disabled,
  width,
  height,
  onClick,
  onHover,
}: Props) {
  const isUser = card.role === "user";
  const opacity = dimmed ? 0.45 : 1;
  const borderColor = active
    ? "var(--accent)"
    : isUser
      ? "rgba(99, 102, 241, 0.4)"
      : "var(--border)";
  const background = isUser
    ? active
      ? "rgba(99, 102, 241, 0.18)"
      : "rgba(99, 102, 241, 0.08)"
    : active
      ? "var(--bg-hover)"
      : "var(--bg-panel)";
  const roleBadge = isUser ? "U" : "A";
  const roleBadgeBg = isUser ? "var(--accent)" : "var(--text-muted)";
  const roleBadgeFg = isUser ? "#fff" : "var(--bg)";

  const displayText = card.text.trim().length > 0 ? card.text : (card.placeholder ?? "");
  const isPlaceholder = card.text.trim().length === 0 && card.placeholder !== null;

  return (
    <button
      type="button"
      onClick={() => onClick(card)}
      onMouseEnter={() => onHover(card)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(card)}
      onBlur={() => onHover(null)}
      title={displayText}
      disabled={disabled}
      aria-disabled={disabled}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        padding: "8px 10px 8px 28px",
        background,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? Math.min(opacity, 0.55) : opacity,
        transition: "opacity 0.12s, border-color 0.12s, background 0.12s",
        textAlign: "left",
        overflow: "hidden",
        font: "inherit",
        color: "var(--text)",
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
      }}
    >
      {/* Role badge in the upper-left corner */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 6,
          left: 6,
          width: 16,
          height: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          background: roleBadgeBg,
          color: roleBadgeFg,
          borderRadius: 3,
          flexShrink: 0,
        }}
      >
        {roleBadge}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11,
          lineHeight: "14px",
          color: isPlaceholder ? "var(--text-muted)" : "var(--text)",
          fontStyle: isPlaceholder ? "italic" : "normal",
          opacity: isPlaceholder ? PLACEHOLDER_OPACITY : 1,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {displayText}
      </span>
      {/* Bottom-right corner: image chip and/or streaming dot */}
      {(card.imageCount > 0 || streaming) && (
        <span
          style={{
            position: "absolute",
            right: 6,
            bottom: 5,
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            color: "var(--text-dim)",
          }}
        >
          {card.imageCount > 0 && (
            <span aria-label={`${card.imageCount} images`} title={`${card.imageCount} images`}>
              🖼️ ×{card.imageCount}
            </span>
          )}
          {streaming && (
            <span
              aria-label="streaming"
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--accent)",
                boxShadow: "0 0 0 2px var(--bg-panel)",
                animation: "pulse 1.2s ease-in-out infinite",
              }}
            />
          )}
        </span>
      )}
    </button>
  );
}