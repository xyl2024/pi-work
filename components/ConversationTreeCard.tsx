"use client";

import type { LayoutCard } from "@/lib/conversationTreeLayout";

interface Props {
  card: LayoutCard;
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
      {/* Bottom-right corner: image chip with count */}
      {card.imageCount > 0 && (
        <span
          aria-label={`${card.imageCount} images`}
          title={`${card.imageCount} images`}
          style={{
            position: "absolute",
            right: 6,
            bottom: 5,
            display: "flex",
            alignItems: "center",
            gap: 3,
            fontSize: 10,
            color: "var(--text-dim)",
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
    </button>
  );
}