"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Drives the height of an expand/collapse container. CSS can't transition
 * `auto`, so the rendered content height is measured via ResizeObserver and
 * exposed as a pixel value for the container's `height` style. Transitions
 * stay off until the first measure so mounting never pops, and content
 * changes (streaming growth, images loading) re-trigger the animation.
 *
 * Measurements taken while the element has no layout box are ignored: e.g. a
 * background session tab whose parent wrapper is `display:none` would otherwise
 * read `scrollHeight` as 0, collapsing the stored height; returning to that tab
 * would then replay the expand transition from 0 → real and jitter the message
 * blocks. Skipping those keeps the last real height so no transition fires.
 */
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
