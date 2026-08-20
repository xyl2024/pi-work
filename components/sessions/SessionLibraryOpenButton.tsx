"use client";

/**
 * SessionLibraryOpenButton — bottom-right launcher for the Session
 * Library modal (Q9C, Q10A).
 *
 * Always visible (Q9C — empty-state is shown inside the modal rather than
 * gating the button). Tracks how many entries the user has already
 * inspected: when the modal is closed and new entries land, a red badge
 * shows the delta so the user knows there's something fresh to look at.
 *
 * Resets its own badge baseline on mount and whenever the active session
 * id changes — we never want a leftover badge from a previous session.
 *
 * Pairs with the existing "全部折叠" / "回到底部" buttons in
 * `ChatWindow`'s bottom-right action stack — sits at the **first**
 * position per Q10A.
 */

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { openSessionLibrary } from "@/hooks/sessionLibraryStore";

interface Props {
  /** Total entry count from `useSessionLibraryEntries(...).entries.length`. */
  count: number;
  /** Active session id — badge baseline resets on session change. */
  sessionId: string | null;
}

export function SessionLibraryOpenButton({ count, sessionId }: Props) {
  const { t } = useI18n();
  const baselineRef = useRef<number>(count);
  const [unread, setUnread] = useState(0);

  // Reset baseline on session change so badge doesn't carry over.
  useEffect(() => {
    baselineRef.current = count;
    setUnread(0);
  }, [sessionId, count]);

  // Recompute unread whenever total changes. Always use the latest count
  // (don't compare against stale baseline from before the modal opened).
  useEffect(() => {
    if (count > baselineRef.current) {
      setUnread(count - baselineRef.current);
    } else {
      setUnread(0);
    }
  }, [count]);

  const handleClick = () => {
    baselineRef.current = count;
    setUnread(0);
    openSessionLibrary();
  };

  return (
    <Tooltip content={t("Open session library")}>
      <button
        type="button"
        onClick={handleClick}
        aria-label={t("Open session library")}
        className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110"
        style={{
          background: "var(--bg-panel)",
          borderColor: "var(--border)",
          color: "var(--text-muted)",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              transform: "translate(14px, -14px)",
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 9,
              background: "#ef4444",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 0 2px var(--bg-panel)",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </Tooltip>
  );
}