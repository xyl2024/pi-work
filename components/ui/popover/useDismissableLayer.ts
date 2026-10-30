"use client";

import { useEffect } from "react";

export interface UseDismissableLayerOptions {
  enabled: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  triggerRef: React.RefObject<HTMLElement | null>;
  onDismiss: () => void;
  restoreFocusOnOutsideClick?: boolean;
}

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
