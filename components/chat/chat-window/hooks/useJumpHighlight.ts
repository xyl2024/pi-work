"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const HIGHLIGHT_DURATION_MS = 2000;

export interface JumpHighlight {
  highlightEntryId: string | null;
  flash: (entryId: string | null) => void;
}

export function useJumpHighlight(): JumpHighlight {
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

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
