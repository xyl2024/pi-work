// Expand-panel glyph (Maximize2). Hovering slides the two corner brackets
// apart/in to suggest "maximize the panel". Fills the ExpandRightIcon role in
// the column (the "expand" affordance when the panel is not expanded).

"use client";

import type { Transition } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle } from "react";

import { ICON_WRAP, useIconHover } from "./shared";

export interface ExpandRightIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ExpandRightIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DEFAULT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 250,
  damping: 25,
};

export const ExpandRightIcon = forwardRef<
  ExpandRightIconHandle,
  ExpandRightIconProps
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
        <motion.path
          animate={controls}
          d="M3 16.2V21m0 0h4.8M3 21l6-6"
          transition={DEFAULT_TRANSITION}
          variants={{
            normal: { translateX: "0%", translateY: "0%" },
            animate: { translateX: "-2px", translateY: "2px" },
          }}
        />
        <motion.path
          animate={controls}
          d="M21 7.8V3m0 0h-4.8M21 3l-6 6"
          transition={DEFAULT_TRANSITION}
          variants={{
            normal: { translateX: "0%", translateY: "0%" },
            animate: { translateX: "2px", translateY: "-2px" },
          }}
        />
      </svg>
    </div>
  );
});

ExpandRightIcon.displayName = "ExpandRightIcon";

export default ExpandRightIcon;