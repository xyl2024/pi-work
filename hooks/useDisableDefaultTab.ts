"use client";

import { useEffect } from "react";

export function useDisableDefaultTab(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.isComposing) return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
}
