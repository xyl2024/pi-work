"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/Tooltip";
import type { Priority } from "@/hooks/useTodos";
import { PRIORITY_PALETTE } from "./palette";
import { PriorityPopover } from "./PriorityPopover";

/**
 * A constant circular indicator rendered to the left of a todo's title when
 * its priority is set. Clicking it opens a small popover with three levels
 * plus a "Clear" option. `undefined` priority means no chip — the title
 * renders flush against the checkbox to keep the row visually calm.
 *
 * The round icon carries the semantic so the user can identify priorities
 * without depending solely on color; this is also helpful for color-blind
 * users (the chip + dot is a redundant encoding of the same info).
 */
export function PriorityChip({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (next: Priority | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const palette = PRIORITY_PALETTE[value];

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <Tooltip content={t(palette.labelKey)} side="top" align="start">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("Set priority")}
          title={t("Set priority")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 14, height: 14,
            borderRadius: "50%",
            border: "none",
            padding: 0,
            cursor: "pointer",
            background: palette.bg,
            color: palette.fg,
            fontSize: 9,
            fontWeight: 700,
            lineHeight: 1,
            fontFamily: "inherit",
          }}
        >
          {palette.glyph}
        </button>
      </Tooltip>
      {open && (
        <PriorityPopover
          current={value}
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}