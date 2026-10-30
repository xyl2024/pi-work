"use client";

import { type RefObject } from "react";
import { useEscapeKey } from "./useEscapeKey";

export function usePanelEscapeGuard(
  containerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
): void {
  useEscapeKey(true, (e) => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && !containerRef.current?.contains(active)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onEscape();
  });
}
