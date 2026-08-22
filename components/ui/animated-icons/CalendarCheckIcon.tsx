// Todo-panel glyph (CalendarCheck). Hovering strokes the check on
// (pathLength 0→1 + fade in) and strokes it back off on leave.

"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle } from "react";

import { ICON_WRAP, useIconHover } from "./shared";

export interface CalendarCheckIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CalendarCheckIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CHECK_VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    opacity: 1,
    transition: { duration: 0.3 },
  },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: {
      pathLength: { duration: 0.4, ease: "easeInOut" },
      opacity: { duration: 0.4, ease: "easeInOut" },
    },
  },
};

export const CalendarCheckIcon = forwardRef<
  CalendarCheckIconHandle,
  CalendarCheckIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
  const controls = useAnimation();
  const start = useCallback(() => controls.start("animate"), [controls]);
  const stop = useCallback(() => controls.start("normal"), [controls]);
  const { isControlledRef, handleMouseEnter, handleMouseLeave } = useIconHover(
    onMouseEnter,
    onMouseLeave,
    start,
    stop,
  );

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return { startAnimation: start, stopAnimation: stop };
  });

  return (
    <div
      className={`${ICON_WRAP} ${className ?? ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect height="18" rx="2" width="18" x="3" y="4" />
        <path d="M3 10h18" />
        <motion.path
          animate={controls}
          d="m9 16 2 2 4-4"
          initial="normal"
          style={{ transformOrigin: "center" }}
          variants={CHECK_VARIANTS}
        />
      </svg>
    </div>
  );
});

CalendarCheckIcon.displayName = "CalendarCheckIcon";

export default CalendarCheckIcon;