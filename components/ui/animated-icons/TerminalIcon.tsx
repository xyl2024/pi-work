// Terminal glyph. The bottom line blinks (repeat:∞) while hovering.

"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle } from "react";

import { ICON_WRAP, useIconHover } from "./shared";

export interface TerminalIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface TerminalIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const LINE_VARIANTS: Variants = {
  normal: { opacity: 1 },
  animate: {
    opacity: [1, 0, 1],
    transition: { duration: 0.8, repeat: Number.POSITIVE_INFINITY, ease: "linear" },
  },
};

export const TerminalIcon = forwardRef<TerminalIconHandle, TerminalIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 16, ...props }, ref) => {
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
          <polyline points="4 17 10 11 4 5" />
          <motion.line
            animate={controls}
            initial="normal"
            variants={LINE_VARIANTS}
            x1="12"
            x2="20"
            y1="19"
            y2="19"
          />
        </svg>
      </div>
    );
  },
);

TerminalIcon.displayName = "TerminalIcon";

export default TerminalIcon;