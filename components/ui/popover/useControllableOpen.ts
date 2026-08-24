"use client";

import { useCallback, useState } from "react";

/**
 * Controlled/uncontrolled `open` state for popovers, dropdowns and pickers.
 *
 * Mirrors Radix's "uncontrolled if `open` is `undefined`, otherwise
 * controlled" convention. The setter accepts either a `boolean` or an
 * updater function (`prev => next`) so callers can flip state from event
 * handlers without depending on the latest snapshot — this is the same
 * shape the DatePicker / TimePicker already relied on (`setOpen(v => !v)`).
 *
 * Always calls `onOpenChange?.(next)` (including in controlled mode), so
 * parents can observe transitions even when they own the state.
 */
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
