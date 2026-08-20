"use client";

import { useCallback, useEffect, useState } from "react";
import { playUiSoundEvent } from "@/lib/client/ui-sounds";

interface MessageListResponse {
  messages: Array<{
    id: string;
    ts: number;
    source: string;
    level: string;
    title: string;
    payload?: Record<string, unknown>;
  }>;
}

const POLL_INTERVAL_MS = 30_000;

/**
 * Global hook for the Inbox bell badge. Mount once at the AppShell level.
 *
 * - Polls `/api/inbox/messages?limit=500` every 30s and reports the total
 *   count. The badge mirrors the inbox exactly: as long as messages exist,
 *   the badge shows their real number; clearing them in the modal drops the
 *   badge on the next tick. The modal does its own 5s polling while open for
 *   the full list.
 * - The bell only needs the count, so the polling interval is intentionally
 *   long — the limit caps payload size and the server doesn't have a dedicated
 *   count endpoint.
 *
 * Fires `playUiSoundEvent("inbox_new")` when the unread count rises between
 * two consecutive polls and the document is hidden. Repeated increments in
 * the same tick are collapsed by `audioContext`'s own minimum-gap, so a
 * flood of messages still produces one chime.
 */
export function useInboxUnreadCount() {
  const [unread, setUnread] = useState(0);

  const fetchUnread = useCallback(async () => {
    try {
      const url = `/api/inbox/messages?limit=500`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as MessageListResponse;
      setUnread((prev) => {
        const next = data.messages.length;
        if (next > prev && typeof document !== "undefined" && document.hidden) {
          playUiSoundEvent("inbox_new");
        }
        return next;
      });
    } catch {
      // ignore — next tick will retry
    }
  }, []);

  useEffect(() => {
    void fetchUnread();
    const id = setInterval(fetchUnread, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchUnread]);

  const refresh = useCallback(() => {
    void fetchUnread();
  }, [fetchUnread]);

  return { unread, refresh };
}