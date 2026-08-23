"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * "Flash" hook for short-lived UI flags — e.g. "copied" / "saved" toasts
 * that turn themselves off after a fixed duration.
 *
 * Returns a tuple `[value, flash]` where `value` is the current state and
 * `flash()` flips it to `true` and schedules a revert to `false` after
 * `durationMs` (default 1500ms). Re-calling `flash()` before the previous
 * timer fires restarts the timer, so spamming the action keeps the flag
 * lit instead of letting it flicker.
 *
 * The internal timer is cleaned up on unmount so a flash scheduled just
 * before navigation doesn't try to set state on an unmounted component.
 *
 *   const [copied, flashCopied] = useTransientFlag();
 *   await copyText(value);
 *   flashCopied();                  // auto-resets after 1.5s
 */
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
