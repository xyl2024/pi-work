"use client";

import { type RefObject } from "react";
import { useEscapeKey } from "./useEscapeKey";

/**
 * Escape handling shared by the panel views that navigate in levels
 * (models config, skills, channels, MCP): while the panel is the focused
 * surface, Escape is always consumed, and `onEscape` decides whether it pops one level or the
 * tab's close rule runs. An event that belongs to a palette / dialog which
 * took focus is left alone so that surface keeps its own Escape.
 */
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
