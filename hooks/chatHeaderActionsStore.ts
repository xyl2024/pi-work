"use client";

import { useSyncExternalStore } from "react";
import { isContentEqual } from "@/lib/client/shallowEqual";

export interface ChatHeaderActions {
  onOpenReplay: () => void;
  replayVisible: boolean;
  onExport: () => void;
  exportVisible: boolean;
  isExporting: boolean;
  onAutoName: () => void;
  autoNameVisible: boolean;
  canAutoName: boolean;
  isAutoNaming: boolean;
  onCompact: () => void;
  compactVisible: boolean;
  isCompacting: boolean;
  compactDisabled: boolean;
  onSetNotifyChannel: (channelId: string | null) => void;
  notifyVisible: boolean;
  currentNotifyChannelId: string | null;
}

let state: ChatHeaderActions | null = null;
let ownerId: string | null = null;
const listeners = new Set<() => void>();

export function setChatHeaderActions(next: ChatHeaderActions | null, nextOwnerId?: string) {
  if (next === null && nextOwnerId && ownerId !== nextOwnerId) return;
  const nextOwner = next === null ? null : nextOwnerId ?? null;
  if (isContentEqual(next, state) && ownerId === nextOwner) return;
  state = next;
  ownerId = nextOwner;
  for (const l of listeners) l();
}

export function useChatHeaderActions(): ChatHeaderActions | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
    () => null,
  );
}
