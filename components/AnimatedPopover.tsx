"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, MouseEventHandler, ReactNode, Ref } from "react";
import { useCollapseHeight } from "@/hooks/useCollapseHeight";

/**
 * Popover wrapper with the ReadFileChips animation language: the panel stays
 * mounted (measured while invisible) so opening and closing both animate —
 * height transitions 0 ↔ measured content, opacity fades, and content that
 * exceeds `maxHeight` becomes scrollable once the height transition settles.
 *
 * `style` carries the panel's positioning (absolute/fixed anchoring) and
 * visual chrome (background, border, radius, shadow, zIndex, widths…). The
 * animation-owned properties (height, opacity, overflow, pointerEvents,
 * transition) are applied by this component and cannot be overridden.
 */
export function AnimatedPopover({ open, style, maxHeight, role, panelRef, onMouseEnter, onMouseLeave, children }: {
  open: boolean;
  style?: CSSProperties;
  /** Optional cap for the animated height (e.g. space above the trigger). */
  maxHeight?: number;
  role?: string;
  panelRef?: Ref<HTMLDivElement>;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const { contentRef, contentHeight, allowAnim } = useCollapseHeight<HTMLDivElement>();
  const [scrolled, setScrolled] = useState(false);

  const targetHeight = contentHeight === null ? 0 : Math.min(contentHeight, maxHeight ?? Infinity);
  const settled = contentHeight === null || contentHeight <= (maxHeight ?? Infinity) || scrolled;

  useEffect(() => {
    if (!open) {
      setScrolled(false);
      return;
    }
    if (contentHeight !== null && maxHeight !== undefined && contentHeight > maxHeight) {
      // Match the height transition duration, then make the list scrollable.
      const id = window.setTimeout(() => setScrolled(true), 260);
      return () => window.clearTimeout(id);
    }
  }, [open, contentHeight, maxHeight]);

  return (
    <div
      ref={panelRef}
      role={role}
      aria-hidden={!open}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        ...style,
        height: open ? targetHeight : 0,
        overflow: !open || !settled ? "hidden" : "auto",
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
        transition: allowAnim ? "height 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease" : "none",
      }}
    >
      <div ref={contentRef} style={{ display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
