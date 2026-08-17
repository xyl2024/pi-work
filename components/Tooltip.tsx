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
  /** Keep the content interactive until the user clicks outside it. */
  interactive?: boolean;
}

export function Tooltip({ content, children, side, align, delayDuration = 500, open, onOpenChange, interactive = false }: Props) {
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
      {/* Decorative tooltips close on trigger leave and do not capture the mouse.
          Interactive tooltips opt into hoverable content and close on outside
          pointer-down instead. */}
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
              pointerEvents: interactive ? "auto" : "none", // the wrapper is disabled in globals.css for decorative tooltips
              maxWidth: 280,
              padding: "4px 10px",
              background: "var(--bg-panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "var(--font-sans)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              animation: "tooltip-in 200ms ease",
            }}
          >
            {content}
            <TooltipPrimitive.Arrow
              style={{ fill: "var(--bg-panel)", stroke: "var(--border)", strokeWidth: 1 }}
              width={8}
              height={4}
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
