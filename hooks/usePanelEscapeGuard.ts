"use client";

import { type RefObject } from "react";
import { useEscapeKey } from "./useEscapeKey";

export interface PanelEscapeFacts {
  visible: boolean;
  focusInsideOrBody: boolean;
}

export function panelEscapeApplies(facts: PanelEscapeFacts): boolean {
  return facts.visible && facts.focusInsideOrBody;
}

export function usePanelEscapeGuard(
  containerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  visible = true,
): void {
  useEscapeKey(true, (e) => {
    const active = document.activeElement;
    const focusInsideOrBody =
      active === null || active === document.body || Boolean(containerRef.current?.contains(active));
    if (!panelEscapeApplies({ visible, focusInsideOrBody })) return;
    e.preventDefault();
    e.stopPropagation();
    onEscape();
  });
}
