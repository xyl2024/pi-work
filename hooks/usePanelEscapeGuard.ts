"use client";

import { type RefObject } from "react";
import { useEscapeKey } from "./useEscapeKey";
import { escapeLayers } from "@/lib/client/escape-layer";

export interface PanelEscapeFacts {
  visible: boolean;
  focusInsideOrBody: boolean;
  layerOpen?: boolean;
}

export function panelEscapeApplies(facts: PanelEscapeFacts): boolean {
  return facts.visible && facts.focusInsideOrBody && !facts.layerOpen;
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
    const layerOpen = escapeLayers.active() !== null;
    if (!panelEscapeApplies({ visible, focusInsideOrBody, layerOpen })) return;
    e.preventDefault();
    e.stopPropagation();
    onEscape();
  });
}
