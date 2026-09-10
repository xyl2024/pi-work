"use client";

/**
 * SidebarFlipContainer — wraps the whole left sidebar as a 3D flip card.
 *
 * The sidebar container is the "card": the front face is the normal
 * Pi Bot / Sessions / Explorer column, the back face is a reserved area for
 * future sidebar content. `flipped` is owned by AppShell so the flip buttons
 * rendered inside each face can drive it.
 *
 * Geometry: the perspective wrapper is a flex child (fills the sidebar's
 * column), the rotating inner element is absolutely positioned over it, and
 * each face is absolutely positioned inside that. Both faces therefore have a
 * definite size, and the front face's `height: 100%` content keeps working.
 */

import { useEffect, useState, type ReactNode } from "react";

const FLIP_MS = 480;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

interface Props {
  front: ReactNode;
  back: ReactNode;
  flipped: boolean;
}

export function SidebarFlipContainer({ front, back, flipped }: Props) {
  // Honor prefers-reduced-motion: swap the faces instantly, skip the tween.
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  return (
    <div
      style={{
        position: "relative",
        flex: "1 1 auto",
        minHeight: 0,
        width: "100%",
        perspective: "1200px",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: reduced ? "none" : `transform ${FLIP_MS}ms ${EASE}`,
        }}
      >
        <Face>{front}</Face>
        <Face back>{back}</Face>
      </div>
    </div>
  );
}

function Face({ children, back = false }: { children: ReactNode; back?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        transform: back ? "rotateY(180deg)" : "none",
      }}
    >
      {children}
    </div>
  );
}
