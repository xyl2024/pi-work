"use client";

import { useCallback, useEffect, useState } from "react";
import type { KeyboardEvent } from "react";

export interface UseInputHistoryOptions {
  /** Active session id. Used to reset the history index on session switch. */
  sessionId: string | null | undefined;
  /** Plain-text user messages from the active session, oldest first.
   *  Sourced from `useAgentSession.messages` (which reflects the backend
   *  .jsonl) so ArrowUp recall matches the real conversation history. */
  userMessageHistory: string[] | undefined;
  /** Current textarea value. Used by ArrowUp's prefix-match buffer logic. */
  value: string;
  /** Apply a recalled history entry to the textarea. Implemented in the
   *  parent because it touches `textareaRef` (focus / setSelectionRange /
   *  height), `setValue`, `setCursorPosition`, and `clearImages` — all of
   *  which live above this hook. */
  navigateTo: (text: string) => void;
}

export interface UseInputHistoryResult {
  /** Current history index. `null` means "not browsing history, regular
   *  draft editing". */
  historyIndex: number | null;
  /** Value the textarea had at the moment the user first pressed ArrowUp;
   *  ArrowDown past the newest entry restores it. */
  draftBeforeHistory: string;
  /** True while the user is in history-recall mode (used to gate edit
   *  handlers so any user edit exits history mode). */
  isInHistoryMode: boolean;
  /** Reset the history index back to null and clear the draft snapshot. */
  exitHistoryMode: () => void;
  /** Handle the ArrowUp / ArrowDown keys. Returns `true` if the event was
   *  consumed (the parent should early-return). */
  handleHistoryKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

/**
 * Input history navigation (fish-style: prefix-match on buffer, with a
 * friendly fallback to "show the newest entry" when the buffer does not
 * match any history prefix). The actual list of historical messages comes
 * from the `userMessageHistory` prop; this hook only owns the index and
 * the draft snapshot used to restore the buffer when the user pastes the
 * newest entry.
 *
 * Skipped entirely when IME composition is active so the user can still
 * use the arrow keys to pick a CJK candidate.
 */
export function useInputHistory({
  sessionId,
  userMessageHistory,
  value,
  navigateTo,
}: UseInputHistoryOptions): UseInputHistoryResult {
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState("");

  // Reset the history index when the session changes so the user starts in
  // "regular draft" mode every time they switch sessions — otherwise
  // pressing ArrowUp in a new session could still be inside the previous
  // session's index. The `userMessageHistory` prop is already derived from
  // the current session, so no manual reload is needed.
  useEffect(() => {
    setHistoryIndex(null);
    setDraftBeforeHistory("");
  }, [sessionId]);

  const exitHistoryMode = useCallback(() => {
    setHistoryIndex(null);
    setDraftBeforeHistory("");
  }, []);

  const handleHistoryKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const history = userMessageHistory ?? [];
      if (e.nativeEvent.isComposing || history.length === 0) return false;

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (historyIndex === null) {
          const buffer = value;
          const needle = buffer.toLowerCase();
          const subset = buffer
            ? history.filter((h) => h.toLowerCase().startsWith(needle))
            : history;
          const pool = subset.length > 0 ? subset : history;
          setDraftBeforeHistory(value);
          setHistoryIndex(0);
          navigateTo(pool[pool.length - 1]);
        } else {
          const next = Math.min(historyIndex + 1, history.length - 1);
          if (next !== historyIndex) {
            setHistoryIndex(next);
            navigateTo(history[history.length - 1 - next]);
          }
        }
        return true;
      }

      if (e.key === "ArrowDown") {
        if (historyIndex === null) return false; // not browsing history → caret moves
        e.preventDefault();
        const next = historyIndex - 1;
        if (next < 0) {
          // Past the newest entry → restore the pre-history draft (E1).
          const draft = draftBeforeHistory;
          setHistoryIndex(null);
          setDraftBeforeHistory("");
          navigateTo(draft);
        } else {
          setHistoryIndex(next);
          navigateTo(history[history.length - 1 - next]);
        }
        return true;
      }

      return false;
    },
    [historyIndex, draftBeforeHistory, userMessageHistory, value, navigateTo],
  );

  return {
    historyIndex,
    draftBeforeHistory,
    isInHistoryMode: historyIndex !== null,
    exitHistoryMode,
    handleHistoryKeyDown,
  };
}