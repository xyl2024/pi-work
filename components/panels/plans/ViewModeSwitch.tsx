"use client";

// The panel-header three-cell switcher for the plans appearance modes (#48):
// 紧凑 / 卡片 / 时间轴. It is the *only* control that changes the mode, and it is
// a real radiogroup so it can be driven from the keyboard: Tab enters on the
// selected cell, then ←/→ (and ↑/↓, Home/End) move the selection. Each cell
// carries a readable label in its `aria-label` / `title`, and the selected one
// is filled with the accent colour so the current mode is obvious.
//
// This component only reports the choice; the panel owns the state and the
// localStorage write (lib/client/plans-view-mode.ts).
import { useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PLAN_VIEW_MODES, type PlanViewMode } from "@/lib/shared/plans";

/** Chinese-namespaced keys (the plain "Compact" / "Timeline" keys already mean
 *  something else in the chat dictionary). */
const MODE_LABEL_KEY: Record<PlanViewMode, string> = {
  compact: "plans.view.compact",
  cards: "plans.view.cards",
  timeline: "plans.view.timeline",
};

export function ViewModeSwitch({
  value,
  onChange,
}: {
  value: PlanViewMode;
  onChange: (mode: PlanViewMode) => void;
}) {
  const { t } = useI18n();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, delta: number) => {
    const count = PLAN_VIEW_MODES.length;
    const next = (from + delta + count) % count;
    onChange(PLAN_VIEW_MODES[next]);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("plans.view.label")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        padding: 1,
        gap: 1,
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
        borderRadius: 6,
      }}
    >
      {PLAN_VIEW_MODES.map((mode, index) => {
        const selected = mode === value;
        const label = t(MODE_LABEL_KEY[mode]);
        return (
          <button
            key={mode}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(mode)}
            onKeyDown={(event) => {
              switch (event.key) {
                case "ArrowRight":
                case "ArrowDown":
                  event.preventDefault();
                  move(index, 1);
                  break;
                case "ArrowLeft":
                case "ArrowUp":
                  event.preventDefault();
                  move(index, -1);
                  break;
                case "Home":
                  event.preventDefault();
                  move(0, 0);
                  break;
                case "End":
                  event.preventDefault();
                  move(PLAN_VIEW_MODES.length - 1, 0);
                  break;
                default:
                  break;
              }
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 18,
              padding: 0,
              color: selected ? "var(--bg)" : "var(--text-dim)",
              background: selected ? "var(--accent)" : "transparent",
              border: "none",
              borderRadius: 4,
              cursor: selected ? "default" : "pointer",
            }}
          >
            <ModeIcon mode={mode} />
          </button>
        );
      })}
    </div>
  );
}

function ModeIcon({ mode }: { mode: PlanViewMode }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (mode === "compact") {
    return (
      <svg {...common} aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    );
  }
  if (mode === "cards") {
    return (
      <svg {...common} aria-hidden>
        <rect x="3" y="4" width="18" height="7" rx="2" />
        <rect x="3" y="14" width="18" height="6" rx="2" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <path d="M6 3v18" />
      <circle cx="6" cy="7" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="6" cy="13" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="6" cy="18.5" r="1.6" fill="currentColor" stroke="none" />
      <path d="M11 7h9M11 13h9M11 18.5h9" />
    </svg>
  );
}
