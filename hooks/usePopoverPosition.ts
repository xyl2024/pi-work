"use client";

import { useLayoutEffect, useState } from "react";

export interface UsePopoverPositionOptions {
  /** Ref to the trigger element to anchor against. */
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Ref to the popover element. The hook measures it to know its size. */
  popoverRef: React.RefObject<HTMLElement | null>;
  /** Whether the popover is currently open. */
  open: boolean;
  /** Anchor the popover to the start or end of the trigger. Default: `"start"`. */
  align?: "start" | "end";
  /** Pixel gap between the trigger and the popover. Default: 6. */
  gap?: number;
  /** Pixel margin kept between the popover and the viewport edge. Default: 8. */
  margin?: number;
  /** Extra deps that may change the popover's height (e.g. month/year inside
   *  a calendar). Triggers a re-measure when any of these change. */
  contentDeps?: ReadonlyArray<unknown>;
}

/**
 * Anchor a `position: fixed` popover to its trigger in viewport coordinates.
 *
 * The hook assumes the popover will be rendered via a React Portal to
 * `document.body` so no CSS `transform`/`filter`/`perspective` ancestor can
 * capture `position: fixed` and rebase it onto itself (which is what
 * `useModalAnimation` does on every modal panel — popovers inside modals
 * would otherwise jump to the wrong screen position).
 */
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