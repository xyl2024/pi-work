// Conversation-tree-panel glyph (FolderTree). Hovering draws the two folder
// panels and their branch stems in sequentially with staggered delays.

"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle } from "react";

import { ICON_WRAP, useIconHover } from "./shared";

export interface ConversationTreeIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ConversationTreeIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DURATION = 0.35;
const CALCULATE_DELAY = (index: number) => index * DURATION + 0.1;

const BRANCH_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1, pathOffset: 0 },
  animate: { pathLength: [0, 1], opacity: [0, 1], pathOffset: [1, 0] },
};

const PANEL_VARIANTS: Variants = {
  normal: { pathLength: 1, opacity: 1 },
  animate: { pathLength: [0, 1], opacity: [0, 1] },
};

export const ConversationTreeIcon = forwardRef<
  ConversationTreeIconHandle,
  ConversationTreeIconProps
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
          d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"
          initial="normal"
          transition={{ duration: DURATION, delay: CALCULATE_DELAY(0), opacity: { delay: CALCULATE_DELAY(0) } }}
          variants={PANEL_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"
          initial="normal"
          transition={{ duration: DURATION, delay: CALCULATE_DELAY(2), opacity: { delay: CALCULATE_DELAY(2) } }}
          variants={PANEL_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M3 5a2 2 0 0 0 2 2h3"
          initial="normal"
          transition={{ duration: DURATION, delay: CALCULATE_DELAY(1), opacity: { delay: CALCULATE_DELAY(1) } }}
          variants={BRANCH_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M3 3v13a2 2 0 0 0 2 2h3"
          initial="normal"
          transition={{ duration: DURATION, delay: CALCULATE_DELAY(3), opacity: { delay: CALCULATE_DELAY(3) } }}
          variants={BRANCH_VARIANTS}
        />
      </svg>
    </div>
  );
});

ConversationTreeIcon.displayName = "ConversationTreeIcon";

export default ConversationTreeIcon;