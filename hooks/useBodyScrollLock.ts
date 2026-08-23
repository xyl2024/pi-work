"use client";

import { useEffect } from "react";

/**
 * Toggle `document.body.style.overflow` to `"hidden"` while `active` is
 * true. Used by modals / fullscreen overlays to prevent background scroll
 * from leaking through. On unmount or when `active` flips back to false,
 * restores the previous value (typically `""` or `"auto"`) so we never
 * strand the page in a hidden state.
 *
 * SSR-safe: no-op until the effect actually runs on the client. Multiple
 * concurrent callers each maintain their own snapshot — the last one to
 * unlock wins, which matches the layered-modal expectation.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
