"use client";

/**
 * Top-right count badge. Returns null when count <= 0.
 *
 * Saturated `--accent` background with text set to `--bg` (the page
 * background), so the badge reads as a "negative" of the page — high
 * contrast in every theme preset, and on dark themes the text becomes
 * dark instead of the dim white-on-light-accent combination that pure
 * white produces.
 *
 * Two sizes:
 *   - `md` (default): 18×18 pill for 36×36 buttons (right-bar column).
 *   - `sm`:           14×14 pill for 28×28 buttons (sidebar bells).
 *
 * Caller must provide `position: relative` on the parent so the badge
 * anchors to its top-right corner.
 */
export type CountBadgeSize = "sm" | "md";

interface CountBadgeProps {
  count: number;
  size?: CountBadgeSize;
}

const SIZE_CONFIG: Record<
  CountBadgeSize,
  {
    minWidth: number;
    height: number;
    borderRadius: number;
    fontSize: number;
    lineHeight: string;
    top: number;
    right: number;
    cappedPaddingX: number;
  }
> = {
  sm: {
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    fontSize: 9,
    lineHeight: "14px",
    top: 2,
    right: 2,
    cappedPaddingX: 4,
  },
  md: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    fontSize: 11,
    lineHeight: "18px",
    top: 0,
    right: 0,
    cappedPaddingX: 5,
  },
};

export function CountBadge({ count, size = "md" }: CountBadgeProps) {
  if (count <= 0) return null;
  const isCapped = count > 99;
  const display = isCapped ? "99+" : String(count);
  const cfg = SIZE_CONFIG[size];
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        top: cfg.top,
        right: cfg.right,
        minWidth: cfg.minWidth,
        height: cfg.height,
        padding: isCapped ? `0 ${cfg.cappedPaddingX}px` : 0,
        borderRadius: cfg.borderRadius,
        background: "var(--accent)",
        color: "var(--bg)",
        fontSize: cfg.fontSize,
        fontWeight: 700,
        lineHeight: cfg.lineHeight,
        textAlign: "center",
        boxSizing: "border-box",
        pointerEvents: "none",
      }}
    >
      {display}
    </span>
  );
}
