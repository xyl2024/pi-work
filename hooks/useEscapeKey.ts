"use client";

import { useEffect } from "react";

/**
 * Bind a window-level Escape handler that's only active while `active` is
 * true. The handler receives the KeyboardEvent so callers can
 * `preventDefault` / `stopPropagation` as needed. The listener is
 * registered with `capture: true` so it fires before per-element handlers
 * (e.g. an open `<input>`'s native Escape-to-blur).
 *
 * Returns nothing. Most callers wrap an existing `onClose` / `requestClose`
 * closure: `useEscapeKey(isVisible, requestClose)`.
 *
 * SSR-safe: no-op until the effect runs on the client. Multiple concurrent
 * callers each get their own listener; the capture phase ensures the most
 * recently mounted one fires first if it calls `stopPropagation()`.
 */
export function useEscapeKey(active: boolean, handler: (e: KeyboardEvent) => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handler(e);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active, handler]);
}
