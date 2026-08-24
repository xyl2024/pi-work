"use client";

import { useEffect } from "react";

export interface UseDismissableLayerOptions {
  /** Whether the dismiss handlers are currently active. */
  enabled: boolean;
  /** Container that should be considered "inside" (clicks here are ignored). */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Trigger element to refocus when the layer is dismissed via Escape. */
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Called when the user clicks outside or presses Escape. */
  onDismiss: () => void;
  /** Whether to refocus the trigger on outside-click dismiss as well.
   *  Default: `false`. Pickers set this to `true` to match the WAI-ARIA
   *  dialog pattern (Escape restores focus; outside-click does not). */
  restoreFocusOnOutsideClick?: boolean;
}

/**
 * Bind the standard popover dismiss behavior to `document`:
 *
 * - `mousedown` outside `containerRef` calls `onDismiss`.
 * - `Escape` calls `onDismiss` and refocuses `triggerRef`.
 *
 * The hook is a no-op while `enabled` is `false`, so the listener isn't
 * paid for when the popover is closed. Listeners are attached on `document`
 * (not `window`) to match the previous picker behavior and to keep
 * composition with other listeners in the app.
 */
export function useDismissableLayer({
  enabled,
  containerRef,
  triggerRef,
  onDismiss,
  restoreFocusOnOutsideClick = false,
}: UseDismissableLayerOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current && containerRef.current.contains(target)) return;
      onDismiss();
      if (restoreFocusOnOutsideClick) {
        // Defer to the next tick so a click on another control can finish
        // its own focus/activation before we steal focus back.
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [enabled, containerRef, triggerRef, onDismiss, restoreFocusOnOutsideClick]);
}
