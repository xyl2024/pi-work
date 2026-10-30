"use client";

import { useEffect, useRef, useState } from "react";

export interface ContainerWidth<T extends HTMLElement> {
  ref: React.RefObject<T | null>;
  width: number | null;
}

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
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
