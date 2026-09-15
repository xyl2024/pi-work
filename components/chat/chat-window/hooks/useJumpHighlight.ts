"use client";

/**
 * The "flash the message a jump landed on" timer.
 *
 * A jump is an imperative concern — a timer, not a rule — so per ADR-0003 it
 * lives in a client hook that owns nothing but its own state; callers resolve
 * the entry id (through the chat timeline) and hand it in. Both jump surfaces
 * share it: the context-composition Top-5 list and the tool-call stats panel
 * only differ in how they find the id.
 *
 * `HIGHLIGHT_DURATION_MS` lives here because this is the module that enforces
 * it; the in-session search jump reads the same constant so "two seconds"
 * cannot drift between the two flashes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a jumped-to message stays highlighted before the class is removed. */
export const HIGHLIGHT_DURATION_MS = 2000;

export interface JumpHighlight {
  /** Entry id currently flashing, or null. */
  highlightEntryId: string | null;
  /**
   * Flash `entryId` for `HIGHLIGHT_DURATION_MS`, replacing any flash still in
   * flight so consecutive jumps move the highlight instead of stacking timers.
   * `null` clears immediately.
   */
  flash: (entryId: string | null) => void;
}

export function useJumpHighlight(): JumpHighlight {
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  // A tab can be closed mid-flash; drop the timer so the class is never left
  // pending on an unmounted row.
  useEffect(() => clearTimer, [clearTimer]);

  const flash = useCallback(
    (entryId: string | null) => {
      clearTimer();
      setHighlightEntryId(entryId);
      if (entryId === null) return;
      timerRef.current = setTimeout(() => {
        setHighlightEntryId(null);
        timerRef.current = null;
      }, HIGHLIGHT_DURATION_MS);
    },
    [clearTimer],
  );

  return { highlightEntryId, flash };
}
