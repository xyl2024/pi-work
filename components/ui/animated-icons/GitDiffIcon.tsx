// Git-diff-panel glyph (GitGraph). Hovering draws the commit nodes (circles)
// and branch stems in sequentially with staggered delays.

"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle } from "react";

import { ICON_WRAP, useIconHover } from "./shared";

export interface GitDiffIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface GitDiffIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DURATION = 0.3;
const CALCULATE_DELAY = (i: number) => (i === 0 ? 0.1 : i * DURATION + 0.1);

const circleVariants = {
  normal: { pathLength: 1, opacity: 1, transition: { delay: 0 } },
  animate: { pathLength: [0, 1], opacity: [0, 1] },
};
const stemVariants = {
  normal: { pathLength: 1, pathOffset: 0, opacity: 1, transition: { delay: 0 } },
  animate: { pathLength: [0, 1], opacity: [0, 1], pathOffset: [1, 0] },
};

export const GitDiffIcon = forwardRef<GitDiffIconHandle, GitDiffIconProps>(
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
          <motion.circle
            animate={controls}
            cx="5"
            cy="6"
            r="3"
            transition={{ duration: DURATION, delay: CALCULATE_DELAY(0), opacity: { delay: CALCULATE_DELAY(0) } }}
            variants={circleVariants}
          />
          <motion.path
            animate={controls}
            d="M5 9v6"
            transition={{ duration: DURATION, delay: CALCULATE_DELAY(1), opacity: { delay: CALCULATE_DELAY(1) } }}
            variants={stemVariants}
          />
          <motion.circle
            animate={controls}
            cx="5"
            cy="18"
            r="3"
            transition={{ duration: DURATION, delay: CALCULATE_DELAY(2), opacity: { delay: CALCULATE_DELAY(2) } }}
            variants={circleVariants}
          />
          <motion.path
            animate={controls}
            d="M12 3v18"
            transition={{ duration: DURATION, delay: CALCULATE_DELAY(1), opacity: { delay: CALCULATE_DELAY(1) } }}
            variants={stemVariants}
          />
          <motion.circle
            animate={controls}
            cx="19"
            cy="6"
            r="3"
            transition={{ duration: DURATION, delay: CALCULATE_DELAY(2), opacity: { delay: CALCULATE_DELAY(2) } }}
            variants={circleVariants}
          />
          <motion.path
            animate={controls}
            d="M16 15.7A9 9 0 0 0 19 9"
            transition={{ duration: DURATION, delay: CALCULATE_DELAY(1), opacity: { delay: CALCULATE_DELAY(1) } }}
            variants={stemVariants}
          />
        </svg>
      </div>
    );
  },
);

GitDiffIcon.displayName = "GitDiffIcon";

export default GitDiffIcon;