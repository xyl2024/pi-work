"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePopoverPosition } from "@/hooks/usePopoverPosition";

export interface PopoverPortalProps {
  open: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
  popoverRef: React.RefObject<HTMLElement | null>;
  align?: "start" | "end";
  gap?: number;
  contentDeps?: ReadonlyArray<unknown>;
  style?: CSSProperties;
  ariaLabel?: string;
  role?: string;
  children: ReactNode;
}

const HIDDEN_OFFSET: Pick<CSSProperties, "left" | "top" | "visibility"> = {
  left: -9999,
  top: -9999,
  visibility: "hidden",
};

export function PopoverPortal({
  open,
  triggerRef,
  popoverRef,
  align = "start",
  gap = 4,
  contentDeps,
  style,
  ariaLabel,
  role = "dialog",
  children,
}: PopoverPortalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const popoverPos = usePopoverPosition({
    triggerRef,
    popoverRef,
    open: open && mounted,
    align,
    gap,
    contentDeps,
  });

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={popoverRef as React.RefObject<HTMLDivElement>}
      role={role}
      aria-label={ariaLabel}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        ...(popoverPos ?? HIDDEN_OFFSET),
        zIndex: 1000,
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
