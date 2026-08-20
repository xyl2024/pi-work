"use client";

import { useSyncExternalStore } from "react";
import { isContentEqual } from "@/lib/client/shallowEqual";

/**
 * Session-scoped header actions: the Replay / Export / Auto-name buttons
 * rendered in the AppShell top bar but owned by ChatWindowContent. Same
 * pattern as sessionUiStore — ChatWindowContent publishes on every render
 * (content-guarded so identical snapshots don't re-render AppShell), clears
 * on unmount, AppShell reads via useChatHeaderActions().
 *
 * Handlers live in the snapshot because they are stable useCallbacks; the
 * content guard compares them by reference (isContentEqual falls back to
 * `a === b` for functions), so a rebuild only re-publishes when a scalar
 * field changed alongside it.
 */

export interface ChatHeaderActions {
  onOpenReplay: () => void;
  /** Non-streaming + has messages — same gate as the old bottom-bar button. */
  replayVisible: boolean;
  onExport: () => void;
  /** Session selected + agent not running — same gate as the old button. */
  exportVisible: boolean;
  isExporting: boolean;
  onAutoName: () => void;
  /** Session selected + agent not running — same gate as the old button. */
  autoNameVisible: boolean;
  /** Session + usable first user message + idle — false renders the button disabled. */
  canAutoName: boolean;
  isAutoNaming: boolean;
  /** Open the manual-compact dialog. */
  onCompact: () => void;
  /** Session selected + agent not running — clicking opens the dialog. */
  compactVisible: boolean;
  /** True while the RPC `compact` call is in flight (shows the spinner glyph). */
  isCompacting: boolean;
  /** Session is busy with another turn (compact button is disabled). */
  compactDisabled: boolean;
}

let state: ChatHeaderActions | null = null;
let ownerId: string | null = null;
const listeners = new Set<() => void>();

export function setChatHeaderActions(next: ChatHeaderActions | null, nextOwnerId?: string) {
  // An old controller's cleanup must not clear the active controller's
  // header actions after a tab switch.
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
