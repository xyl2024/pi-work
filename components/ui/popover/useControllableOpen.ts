"use client";

import { useCallback, useState } from "react";

export function useControllableOpen(
  openProp: boolean | undefined,
  onOpenChange?: (open: boolean) => void,
) {
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? openProp : internalOpen;

  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(open) : next;
      if (!isControlled) setInternalOpen(resolved);
      onOpenChange?.(resolved);
    },
    [isControlled, open, onOpenChange],
  );

  return { open, setOpen, isControlled };
}
