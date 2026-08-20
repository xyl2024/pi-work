/**
 * useNow — a `Date.now()`-shaped reactive clock that updates on a
 * configurable cadence. Used everywhere we display relative times
 * ("2h 14m 后") so they re-render without each component owning its
 * own setInterval. Default 30s is enough for "next run" copy; bump
 * to 1s only inside the run history while a task is in flight.
 */

import { useEffect, useState } from "react";

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}