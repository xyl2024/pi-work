"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Priority } from "@/hooks/useTodos";
import { PRIORITY_PALETTE } from "./palette";

/**
 * Picker rendered when a PriorityChip is clicked. Mirrors SortPopover's
 * outside-click + Esc handling, but emits an explicit "clear" option
 * (passing `null`) in addition to the three enum values. The currently
 * selected priority is shown with a filled dot — same affordance as
 * StatusFilter and DeadlineFilter, so the pattern stays consistent.
 */
export function PriorityPopover({
  current,
  onSelect,
  onClose,
}: {
  current: Priority;
  onSelect: (next: Priority | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  // Use the same local order as priorityRank (high > medium > low). `null`
  // is rendered as a separate "Clear" entry after a thin divider so it
  // doesn't get confused with a normal priority choice.
  const choices: { key: Priority | "clear"; selected: boolean; onClick: () => void; render: () => React.ReactNode }[] = [
    {
      key: "high",
      selected: current === "high",
      onClick: () => onSelect("high"),
      render: () => (
        <span aria-hidden style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: PRIORITY_PALETTE.high.bg, color: PRIORITY_PALETTE.high.fg, fontSize: 9, fontWeight: 700 }}>
          {PRIORITY_PALETTE.high.glyph}
        </span>
      ),
    },
    {
      key: "medium",
      selected: current === "medium",
      onClick: () => onSelect("medium"),
      render: () => (
        <span aria-hidden style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: PRIORITY_PALETTE.medium.bg, color: PRIORITY_PALETTE.medium.fg, fontSize: 9, fontWeight: 700 }}>
          {PRIORITY_PALETTE.medium.glyph}
        </span>
      ),
    },
    {
      key: "low",
      selected: current === "low",
      onClick: () => onSelect("low"),
      render: () => (
        <span aria-hidden style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: PRIORITY_PALETTE.low.bg, color: PRIORITY_PALETTE.low.fg, fontSize: 9, fontWeight: 700 }}>
          {PRIORITY_PALETTE.low.glyph}
        </span>
      ),
    },
    {
      key: "clear",
      selected: false,
      onClick: () => onSelect(null),
      render: () => (
        <span aria-hidden style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", border: "1px dashed var(--text-dim)" }} />
      ),
    },
  ];

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("Set priority")}
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        zIndex: 10,
        minWidth: 152,
        padding: 6,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <div style={{ fontSize: 10, color: "var(--text-dim)", padding: "2px 8px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {t("Priority")}
      </div>
      <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {choices.slice(0, 3).map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={c.selected}
            onClick={c.onClick}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px",
              fontSize: 11,
              textAlign: "left",
              background: c.selected ? "var(--bg-selected)" : "transparent",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              color: c.selected ? "var(--text)" : "var(--text-muted)",
              fontFamily: "inherit",
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 10, height: 10, flexShrink: 0,
                border: `1.2px solid ${c.selected ? "var(--accent)" : "var(--text-dim)"}`,
                borderRadius: "50%",
              }}
            >
              {c.selected && (
                <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--accent)" }} />
              )}
            </span>
            {c.render()}
            {c.key === "high" && t("High priority")}
            {c.key === "medium" && t("Medium priority")}
            {c.key === "low" && t("Low priority")}
          </button>
        ))}
        <div style={{ height: 1, background: "var(--border)", margin: "4px 8px" }} />
        <button
          type="button"
          role="radio"
          aria-checked={false}
          onClick={() => onSelect(null)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 8px",
            fontSize: 11,
            textAlign: "left",
            background: "transparent",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            color: "var(--text-muted)",
            fontFamily: "inherit",
          }}
        >
          {choices[3].render()}
          {t("Clear")}
        </button>
      </div>
    </div>
  );
}