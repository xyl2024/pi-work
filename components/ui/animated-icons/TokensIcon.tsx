// Token-audit-panel glyph (ChartSpline). Hovering strokes the spline up.

"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle } from "react";

import { ICON_WRAP, useIconHover } from "./shared";

export interface TokensIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface TokensIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: { delay: 0.15, duration: 0.3, opacity: { delay: 0.1 } },
  },
};

export const TokensIcon = forwardRef<TokensIconHandle, TokensIconProps>(
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
          <path d="M3 3v16a2 2 0 0 0 2 2h16" />
          <motion.path
            animate={controls}
            d="M7 16c.5-2 1.5-7 4-7 2 0 2 3 4 3 2.5 0 4.5-5 5-7"
            variants={VARIANTS}
          />
        </svg>
      </div>
    );
  },
);

TokensIcon.displayName = "TokensIcon";

export default TokensIcon;