"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useTransientFlag(durationMs = 1500): [boolean, () => void] {
  const [value, setValue] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const flash = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setValue(true);
    timerRef.current = setTimeout(() => {
      setValue(false);
      timerRef.current = null;
    }, durationMs);
  }, [durationMs]);

  return [value, flash];
}
