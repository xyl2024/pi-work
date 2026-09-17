"use client";

// Icon-only 「隐藏已完成 / 显示已完成」 toggle for the plans panel header. The two
// states are *one* glyph that converts instead of two icons that swap: the
// slash is drawn off the end of its own path while the pupil shrinks away, so
// the click reads as a single motion. The surface and colour transition with it
// through `IconButton`'s `active` state.
//
// The label names the action the click performs (「显示已完成」 while completed
// plans are hidden), so the tooltip and the accessible name agree with what
// happens.

import { useI18n } from "@/hooks/useI18n";
import { IconButton } from "@/components/ui/IconButton";

/** The eye-off slash, drawn from the top-left. `pathLength` normalises it to 1
 *  so the dash can be expressed as "fully off" / "fully on". */
const SLASH = "M2 2l20 20";

export function HideDoneToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const label = t(hidden ? "Show completed" : "Hide completed");

  return (
    <IconButton label={label} size="sm" active={hidden} onClick={onToggle}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle
          cx="12"
          cy="12"
          r="3"
          style={{
            transformBox: "fill-box",
            transformOrigin: "center",
            transform: hidden ? "scale(0.3)" : "scale(1)",
            opacity: hidden ? 0 : 1,
            transition: "transform 0.22s ease, opacity 0.18s ease",
          }}
        />
        <path
          d={SLASH}
          pathLength={1}
          strokeDasharray={1}
          style={{
            strokeDashoffset: hidden ? 0 : 1,
            transition: "stroke-dashoffset 0.24s ease",
          }}
        />
      </svg>
    </IconButton>
  );
}
