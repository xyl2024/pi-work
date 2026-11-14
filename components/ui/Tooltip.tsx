"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useState, type ReactNode } from "react";

interface Props {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  interactive?: boolean;
  maxWidth?: number;
}

export function Tooltip({ content, children, side, align, delayDuration = 500, open, onOpenChange, interactive = false, maxWidth: maxWidthProp }: Props) {
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const interactiveUncontrolled = interactive && open === undefined;
  const effectiveOpen = interactiveUncontrolled ? interactiveOpen : open;
  const handleOpenChange = (nextOpen: boolean) => {
    if (interactiveUncontrolled && nextOpen) setInteractiveOpen(true);
    onOpenChange?.(nextOpen);
  };
  const handlePointerDownOutside = interactive
    ? () => {
        if (interactiveUncontrolled) setInteractiveOpen(false);
      }
    : undefined;

  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root
        open={effectiveOpen}
        onOpenChange={handleOpenChange}
        disableHoverableContent={!interactive}
      >
        <TooltipPrimitive.Trigger asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={5}
            onPointerDownOutside={handlePointerDownOutside}
            data-interactive-tooltip={interactive ? "true" : undefined}
            style={{
              zIndex: 9999,
              pointerEvents: interactive ? "auto" : "none",
              maxWidth: maxWidthProp ?? 280,
              padding: "5px 9px",
              background: "var(--bg-elevated)",
              color: "var(--text)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-line",
              fontFamily: "var(--font-sans)",
              boxShadow: "var(--elevation-prominent)",
              animation: "tooltip-in 140ms var(--ease-out)",
            }}
          >
            {content}
            <TooltipPrimitive.Arrow
              style={{ fill: "var(--bg-elevated)" }}
              width={8}
              height={4}
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
