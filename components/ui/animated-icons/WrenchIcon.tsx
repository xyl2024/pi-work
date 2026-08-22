// Tool-calls-panel glyph (Wrench). Hovering gives the wrench head a quick
// loose-wiggle. Shares the slot with the running/total counter in desc.tsx
// (RightBarButton bodyLayout: column + gap), so the wrapper stays shrink-wrap.

"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle } from "react";

import { ICON_WRAP, useIconHover } from "./shared";

export interface WrenchIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface WrenchIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const ICON_VARIANTS: Variants = {
  normal: { rotate: 0, transition: { duration: 0.25, ease: "easeOut" } },
  animate: {
    rotate: [0, 12, -14, 4, 0],
    transition: {
      duration: 1.05,
      times: [0, 0.42, 0.68, 0.88, 1],
      ease: ["easeInOut", "easeInOut", "easeOut", "easeOut"],
    },
  },
};

export const WrenchIcon = forwardRef<WrenchIconHandle, WrenchIconProps>(
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
        <motion.svg
          animate={controls}
          fill="none"
          height={size}
          initial="normal"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          style={{ transformOrigin: "90% 10%", transformBox: "fill-box" }}
          variants={ICON_VARIANTS}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />
        </motion.svg>
      </div>
    );
  },
);

WrenchIcon.displayName = "WrenchIcon";

export default WrenchIcon;