"use client";

import { useEffect } from "react";
import { selectTabByKind, type PanelTabsState, type PanelViewKind } from "@/lib/shared/panelTabs";
import type { PanelViewCloseGuard } from "@/lib/client/panel-view-store";

export interface PanelViewLifecycleStore {
  readonly kind: string;
  guard(): PanelViewCloseGuard | null;
  requestClose(confirm: () => boolean): Promise<boolean>;
  release(): void;
}

export function usePanelViewLifecycleSync(
  panelTabsState: PanelTabsState,
  stores: readonly PanelViewLifecycleStore[],
): void {
  useEffect(() => {
    for (const store of stores) {
      if (selectTabByKind(panelTabsState, store.kind as PanelViewKind) === null) store.release();
    }
  }, [panelTabsState, stores]);
}
