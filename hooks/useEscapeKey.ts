"use client";

import { useEffect } from "react";

export function useEscapeKey(active: boolean, handler: (e: KeyboardEvent) => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handler(e);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active, handler]);
}
