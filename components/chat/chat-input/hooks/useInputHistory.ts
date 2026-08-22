"use client";

import { useCallback, useEffect, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

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
  /** Ref to the textarea so we can read its live `selectionStart` /
   *  `selectionEnd` at keydown time. Needed by the multi-line caret-edge
   *  guard below — the parent state (`cursorPosition`) can lag a click
   *  that lands on a collapsed selection at position 0, while the ref
   *  always reflects what the browser actually sees. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
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
  textareaRef,
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

      // Read the live caret / selection from the textarea so the
      // multi-line edge guard below sees exactly what the browser sees
      // at keydown time. Falls back to (0, 0) when the ref isn't ready,
      // which still satisfies `cursorAtTop` for an empty buffer.
      const ta = textareaRef.current;
      const selectionStart = ta?.selectionStart ?? 0;
      const selectionEnd = ta?.selectionEnd ?? 0;
      // Treat any non-collapsed selection as "not at the edge" — the
      // user is more likely extending the selection than navigating
      // history. This also covers shift-click ranges that happen to
      // start at 0 / end at length.
      const collapsed = selectionStart === selectionEnd;
      const isMultiLine = value.includes("\n");
      const cursorAtTop = collapsed && selectionStart === 0;
      const cursorAtBottom = collapsed && selectionStart === value.length;

      if (e.key === "ArrowUp") {
        // Multi-line drafts are easy to accidentally yank with ArrowUp
        // when the caret sits in the middle of the buffer. Require the
        // caret to be parked on the very first character (no selection)
        // before we enter history mode; single-line drafts keep the
        // original "ArrowUp anywhere recalls" behavior so muscle memory
        // from one-liner prompts still works.
        if (isMultiLine && !cursorAtTop) return false;
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
        // Symmetric guard for multi-line recalled entries: the caret has
        // to be parked at the very end (no selection) before we step
        // forward through history. Otherwise let the browser move the
        // caret down by one visual line — matches the ArrowUp rule.
        if (isMultiLine && !cursorAtBottom) return false;
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
    [historyIndex, draftBeforeHistory, userMessageHistory, value, navigateTo, textareaRef],
  );

  return {
    historyIndex,
    draftBeforeHistory,
    isInHistoryMode: historyIndex !== null,
    exitHistoryMode,
    handleHistoryKeyDown,
  };
}