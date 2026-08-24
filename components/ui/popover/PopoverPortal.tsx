"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePopoverPosition } from "@/hooks/usePopoverPosition";

export interface PopoverPortalProps {
  /** Whether the popover is currently open. When `false`, returns `null`. */
  open: boolean;
  /** Ref to the trigger element used for anchoring. */
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Ref to the popover element. Provided so the position hook can measure it. */
  popoverRef: React.RefObject<HTMLElement | null>;
  /** `start` (default) anchors the popover to the trigger's left edge;
   *  `end` anchors to the right edge. */
  align?: "start" | "end";
  /** Pixel gap between trigger and popover. Default: `4`. */
  gap?: number;
  /** Extra deps that may change the popover's height and therefore require
   *  a re-measure (e.g. the viewed month/year in a calendar). */
  contentDeps?: ReadonlyArray<unknown>;
  /** Style overrides for the popover container. Position (`left`, `top`,
   *  `visibility`) is owned by this component and cannot be overridden. */
  style?: CSSProperties;
  /** Accessible label for the popover dialog. */
  ariaLabel?: string;
  /** Role for the popover container. Default: `"dialog"`. */
  role?: string;
  children: ReactNode;
}

const HIDDEN_OFFSET: Pick<CSSProperties, "left" | "top" | "visibility"> = {
  left: -9999,
  top: -9999,
  visibility: "hidden",
};

/**
 * Render an open popover into a React Portal at `document.body`.
 *
 * Encapsulates the pieces both DatePicker and TimePicker used to repeat:
 *
 *  - SSR-safe mount flag: the portal only renders after the first client
 *    effect, so the server-rendered tree has no portal and we don't get a
 *    hydration mismatch.
 *  - `usePopoverPosition` for fixed-viewport anchoring with viewport-edge
 *    clamping.
 *  - `mousedown` / `click` stop-propagation so the dismissable layer
 *    registered by `useDismissableLayer` doesn't treat clicks inside the
 *    popover as "outside" dismisses.
 *
 * Returns `null` while closed or before mount; consumers don't need to
 * gate rendering themselves.
 */
export function PopoverPortal({
  open,
  triggerRef,
  popoverRef,
  align = "start",
  gap = 4,
  contentDeps,
  style,
  ariaLabel,
  role = "dialog",
  children,
}: PopoverPortalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const popoverPos = usePopoverPosition({
    triggerRef,
    popoverRef,
    open: open && mounted,
    align,
    gap,
    contentDeps,
  });

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={popoverRef as React.RefObject<HTMLDivElement>}
      role={role}
      aria-label={ariaLabel}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        ...(popoverPos ?? HIDDEN_OFFSET),
        zIndex: 1000,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
