// Settings glyph. The gear rotates 180° on hover (snappy spring).

"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle } from "react";

import { ICON_WRAP, useIconHover } from "./shared";

export interface SettingsIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SettingsIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

export const SettingsIcon = forwardRef<SettingsIconHandle, SettingsIconProps>(
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
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          transition={{ type: "spring", stiffness: 50, damping: 10 }}
          variants={{
            normal: { rotate: 0 },
            animate: { rotate: 180 },
          }}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </motion.svg>
      </div>
    );
  },
);

SettingsIcon.displayName = "SettingsIcon";

export default SettingsIcon;