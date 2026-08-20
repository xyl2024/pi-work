"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const DEFAULT_DURATION_MS = 180;
const DEFAULT_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

interface IndicatorGeometry {
  ready: boolean;
  /** TranslateX in container-local pixels (relative to container's left edge). */
  x: number;
  /** Visual width of the indicator, in pixels. */
  width: number;
  /** Container's measured width — used as the scaleX denominator. */
  containerWidth: number;
}

export interface SlidingTabIndicatorProps {
  /** Ref to the `position: relative; overflow: hidden` wrapper that hosts the
   *  scroll container. The indicator is positioned within this wrapper. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref to the inner `overflow-x: auto` scroll container. Used to observe
   *  user scroll and update the indicator instantly without animation. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Active tab id, or null when no tab is active. */
  activeId: string | null;
  /** Returns the DOM element for a given tab id. Callers typically attach a
   *  `data-tab-id` attribute to each tab and resolve via `querySelector`. */
  getTabEl: (id: string) => HTMLElement | null;
}

export function SlidingTabIndicator({
  containerRef,
  scrollRef,
  activeId,
  getTabEl,
}: SlidingTabIndicatorProps) {
  const [geometry, setGeometry] = useState<IndicatorGeometry>({
    ready: false,
    x: 0,
    width: 0,
    containerWidth: 0,
  });
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  const rafRef = useRef<number | null>(null);

  // Honor `prefers-reduced-motion` for users who disable animations.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setDurationMs(mq.matches ? 0 : DEFAULT_DURATION_MS);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const measure = useCallback(() => {
    if (!activeId) {
      setGeometry((prev) =>
        prev.ready
          ? { ready: false, x: 0, width: 0, containerWidth: 0 }
          : prev,
      );
      return;
    }
    const container = containerRef.current;
    const tabEl = getTabEl(activeId);
    if (!container || !tabEl) {
      setGeometry((prev) =>
        prev.ready
          ? { ready: false, x: 0, width: 0, containerWidth: 0 }
          : prev,
      );
      return;
    }
    // Use viewport-relative rects so we don't depend on offsetParent chains;
    // subtracting gives us the tab's position inside the overflow:hidden wrapper.
    const containerRect = container.getBoundingClientRect();
    const tabRect = tabEl.getBoundingClientRect();
    const x = tabRect.left - containerRect.left;
    const width = tabRect.width;
    const containerWidth = containerRect.width;
    setGeometry({ ready: true, x, width, containerWidth });
  }, [activeId, containerRef, getTabEl]);

  // Re-measure on mount and whenever activeId changes. Layout effect avoids
  // a one-frame flicker before the indicator knows where it should be.
  useIsomorphicLayoutEffect(() => {
    measure();
  }, [measure]);

  // User scroll → instant follow, no animation. rAF-throttled to coalesce
  // bursty trackpad/wheel events into at most one measurement per frame.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const onScroll = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        measure();
      });
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scrollRef, measure]);

  // Container resize (window resize, sidebars opening, etc.) and active-tab
  // width changes (label length changes after locale switch, dirty dot
  // appears, etc.) all invalidate our cached geometry.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        measure();
      });
    });
    ro.observe(container);
    if (activeId) {
      const tabEl = getTabEl(activeId);
      if (tabEl) ro.observe(tabEl);
    }
    return () => ro.disconnect();
  }, [containerRef, activeId, getTabEl, measure]);

  if (!geometry.ready || geometry.containerWidth === 0 || geometry.width === 0) {
    return null;
  }

  const scaleX = geometry.width / geometry.containerWidth;
  const transition =
    durationMs === 0
      ? "none"
      : `transform ${durationMs}ms ${DEFAULT_EASING}`;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        height: 2,
        width: geometry.containerWidth,
        background: "var(--accent)",
        borderRadius: 1,
        transform: `translateX(${geometry.x}px) scaleX(${scaleX})`,
        transformOrigin: "left center",
        transition,
        pointerEvents: "none",
        willChange: "transform",
        zIndex: 1,
      }}
    />
  );
}
