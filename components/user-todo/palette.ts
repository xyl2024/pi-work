"use client";

import type { Priority } from "@/hooks/useTodos";

/**
 * Priority chip palette + glyph. The same color/glyph triple is reused by
 * the Filter popover's preview swatch (FilterPopover.prioritySwatch) and
 * by the inline chip on each todo row — keep them all in sync here.
 *
 * Mirrored narrowly in components/TodoMonthCalendar.tsx as
 * `CALENDAR_PRIORITY_DOT` (no labelKey) so the calendar's tooltip
 * doesn't pull the entire TodoPanel into its import surface.
 */
export const PRIORITY_PALETTE: Record<Priority, { bg: string; fg: string; glyph: string; labelKey: string }> = {
  high:   { bg: "#ef4444", fg: "#ffffff", glyph: "!", labelKey: "High priority" },
  medium: { bg: "#f97316", fg: "#ffffff", glyph: "=", labelKey: "Medium priority" },
  low:    { bg: "#3b82f6", fg: "#ffffff", glyph: "↓", labelKey: "Low priority" },
};