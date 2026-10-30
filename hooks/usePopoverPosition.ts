"use client";

import { useLayoutEffect, useState } from "react";

export interface UsePopoverPositionOptions {
  triggerRef: React.RefObject<HTMLElement | null>;
  popoverRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  align?: "start" | "end";
  gap?: number;
  margin?: number;
  contentDeps?: ReadonlyArray<unknown>;
}

export function usePopoverPosition({
  triggerRef,
  popoverRef,
  open,
  align = "start",
  gap = 6,
  margin = 8,
  contentDeps,
}: UsePopoverPositionOptions) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    const measure = () => {
      const tr = trigger.getBoundingClientRect();
      const pr = popover.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;

      let left: number;
      if (align === "start") {
        left = tr.left;
        if (left + pr.width > vw - margin) left = tr.right - pr.width;
      } else {
        left = tr.right - pr.width;
        if (left < margin) left = tr.left;
      }
      left = Math.max(margin, Math.min(left, vw - pr.width - margin));

      let top: number;
      const belowTop = tr.bottom + gap;
      const aboveTop = tr.top - gap - pr.height;
      if (belowTop + pr.height <= vh - margin) {
        top = belowTop;
      } else if (aboveTop >= margin) {
        top = aboveTop;
      } else {
        const belowRoom = vh - margin - belowTop;
        const aboveRoom = aboveTop - margin;
        top = belowRoom >= aboveRoom ? belowTop : Math.max(margin, aboveTop);
      }

      setPos({ left, top });
    };
    measure();

    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align, gap, margin, ...(contentDeps ?? [])]);

  return pos;
}