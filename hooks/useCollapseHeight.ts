"use client";

import { useEffect, useRef, useState } from "react";

export function useCollapseHeight<T extends HTMLElement>() {
  const contentRef = useRef<T>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [allowAnim, setAllowAnim] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAllowAnim(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const update = () => {
      if (!el.isConnected || el.getClientRects().length === 0) return;
      setContentHeight((prev) => (prev === el.scrollHeight ? prev : el.scrollHeight));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { contentRef, contentHeight, allowAnim };
}
