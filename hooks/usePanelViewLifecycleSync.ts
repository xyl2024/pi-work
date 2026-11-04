"use client";

import { useEffect } from "react";
import { selectTabByKind, type PanelTabsState } from "@/lib/shared/panelTabs";
import type { ViewKind } from "@/lib/client/panel-view-store";
import type { PanelViewCloseGuard } from "@/lib/client/panel-view-store";

export interface PanelViewLifecycleStore {
  readonly kind: ViewKind;
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
      if (selectTabByKind(panelTabsState, store.kind) === null) store.release();
    }
  }, [panelTabsState, stores]);
}
