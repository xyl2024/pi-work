"use client";

import { useCallback, useEffect, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

export interface UseInputHistoryOptions {
  sessionId: string | null | undefined;
  userMessageHistory: string[] | undefined;
  value: string;
  navigateTo: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export interface UseInputHistoryResult {
  historyIndex: number | null;
  draftBeforeHistory: string;
  isInHistoryMode: boolean;
  exitHistoryMode: () => void;
  handleHistoryKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

export function useInputHistory({
  sessionId,
  userMessageHistory,
  value,
  navigateTo,
  textareaRef,
}: UseInputHistoryOptions): UseInputHistoryResult {
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState("");

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

      const ta = textareaRef.current;
      const selectionStart = ta?.selectionStart ?? 0;
      const selectionEnd = ta?.selectionEnd ?? 0;
      const collapsed = selectionStart === selectionEnd;
      const isMultiLine = value.includes("\n");
      const cursorAtTop = collapsed && selectionStart === 0;
      const cursorAtBottom = collapsed && selectionStart === value.length;

      if (e.key === "ArrowUp") {
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
        if (historyIndex === null) return false;
        if (isMultiLine && !cursorAtBottom) return false;
        e.preventDefault();
        const next = historyIndex - 1;
        if (next < 0) {
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