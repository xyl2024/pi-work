"use client";

import { useEffect, useRef, useState } from "react";

export interface ContainerWidth<T extends HTMLElement> {
  /** Attach to the element whose *content* width should be measured. */
  ref: React.RefObject<T | null>;
  /** Measured width in px, or `null` before the first measurement. */
  width: number | null;
}

/**
 * Track an element's own width with a `ResizeObserver`.
 *
 * The reason a viewport breakpoint cannot do this job: in Pi Work the chat
 * column also loses width whenever the session sidebar or the right panel is
 * open, so the constraint on a toolbar inside it is the container, not the
 * window.
 *
 * Measurement only starts after mount (the ref is `null` during SSR), so
 * callers must treat `width === null` as "not measured yet" rather than as
 * zero. Sub-pixel churn (< 0.5px) is ignored to keep re-renders quiet.
 */
export function useContainerWidth<T extends HTMLElement>(): ContainerWidth<T> {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const next = element.getBoundingClientRect().width;
      setWidth((prev) => (prev !== null && Math.abs(prev - next) < 0.5 ? prev : next));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      // Older WebViews: fall back to window resizes. Less precise (a sidebar
      // drag does not fire it) but never worse than no measurement at all.
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
