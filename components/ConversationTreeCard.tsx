"use client";

import type { LayoutCard } from "@/lib/conversationTreeLayout";

interface Props {
  card: LayoutCard;
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

/**
 * Preview text for the card. Empty `card.text` falls back to the
 * placeholder (e.g. "[完成工具调用]"). All whitespace (spaces + newlines)
 * is collapsed away — the card is a tiny badge, and stripping whitespace
 * helps the 3-line clamp render readably. The tooltip keeps the full
 * formatted text.
 */
function previewText(card: LayoutCard): string {
  const raw = card.text.trim().length > 0 ? card.text : (card.placeholder ?? "");
  return raw.replace(/\s+/g, "");
}

export function ConversationTreeCard({
  card,
  streaming,
  disabled,
  width,
  height,
  onClick,
  onHover,
}: Props) {
  const isUser = card.role === "user";
  const borderColor = isUser
    ? "rgba(99, 102, 241, 0.4)"
    : "var(--border)";
  const background = isUser
    ? "rgba(99, 102, 241, 0.08)"
    : "var(--bg-panel)";

  const displayText = previewText(card);
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
        padding: "8px 10px",
        background,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.12s, border-color 0.12s",
        textAlign: "left",
        overflow: "hidden",
        font: "inherit",
        color: "var(--text)",
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
      }}
    >
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