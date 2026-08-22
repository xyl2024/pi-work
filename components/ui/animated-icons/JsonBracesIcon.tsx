// JSON-panel glyph (FolderCode). Hovering nudges the two `</>` code brackets
// apart/pivot via `custom={±1}` directional variants.

"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle } from "react";

import { ICON_WRAP, useIconHover } from "./shared";

export interface JsonBracesIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface JsonBracesIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CODE_VARIANTS: Variants = {
  normal: { x: 0, rotate: 0, opacity: 1 },
  animate: (direction: number) => ({
    x: [0, direction * 2, 0],
    rotate: [0, direction * -8, 0],
    opacity: 1,
    transition: { duration: 0.5, ease: "easeInOut" },
  }),
};

export const JsonBracesIcon = forwardRef<JsonBracesIconHandle, JsonBracesIconProps>(
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
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
          <motion.path
            animate={controls}
            custom={-1}
            d="M10 10.5 8 13l2 2.5"
            initial="normal"
            variants={CODE_VARIANTS}
          />
          <motion.path
            animate={controls}
            custom={1}
            d="m14 10.5 2 2.5-2 2.5"
            initial="normal"
            variants={CODE_VARIANTS}
          />
        </svg>
      </div>
    );
  },
);

JsonBracesIcon.displayName = "JsonBracesIcon";

export default JsonBracesIcon;