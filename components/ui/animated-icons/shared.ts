// Shared bits for the motion-animated icons in this directory.
//
//   - `ICON_WRAP`: base classes for the wrapper div. `inline-flex` shrink-wraps
//     the glyph so a column-stacked body (e.g. the tool-calls running/total
//     counter) isn't stretched by the wrapper:
//   - `useIconHover`: the standard self-animate/controlled hover wiring every
//     animated icon uses. When the component is rendered with no ref it
//     self-animates on hover; once an imperative handle is bound (via
//     useImperativeHandle setting `isControlledRef` to true) it stops hovering
//     on its own and defers to the caller's start/stop.

"use client";

import { useCallback, useRef } from "react";

export const ICON_WRAP = "inline-flex items-center justify-center";

export function useIconHover(
  onMouseEnter: ((e: React.MouseEvent<HTMLDivElement>) => void) | undefined,
  onMouseLeave: ((e: React.MouseEvent<HTMLDivElement>) => void) | undefined,
  start: () => void,
  stop: () => void,
): {
  isControlledRef: React.MutableRefObject<boolean>;
  handleMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => void;
} {
  const isControlledRef = useRef(false);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseEnter?.(e);
      } else {
        start();
      }
    },
    [onMouseEnter, start],
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseLeave?.(e);
      } else {
        stop();
      }
    },
    [onMouseLeave, stop],
  );

  return { isControlledRef, handleMouseEnter, handleMouseLeave };
}