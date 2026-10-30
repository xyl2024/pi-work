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