"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

interface Props {
  open: boolean;
  durationMs?: number;
  children: ReactNode;
  style?: CSSProperties;
}

export function CollapsiblePanel({ open, durationMs = 180, children, style }: Props) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(r);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [open, durationMs]);

  if (!mounted) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: visible ? "1fr" : "0fr",
        opacity: visible ? 1 : 0,
        transition: `grid-template-rows ${durationMs}ms cubic-bezier(0.32, 0.72, 0, 1), opacity ${Math.round(durationMs * 0.6)}ms ease ${Math.round(durationMs * 0.3)}ms`,
        ...style,
      }}
    >
      <div style={{ overflow: "hidden", minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}
