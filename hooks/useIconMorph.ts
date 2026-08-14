"use client";

/**
 * useIconMorph — imperative DOM hook over morphicons/dom.
 *
 * Renders a single <svg><path d={...}/></svg> and morphs the `d` attribute
 * with spring physics when `active` flips. The morph driver is born lazily
 * on first effect, so server + client agree on the initial `d` (no
 * hydration mismatch) and there's no work to undo on unmount beyond the
 * driver's own rAF teardown.
 *
 * Usage:
 *   const { svgProps, pathProps } = useIconMorph(MENU, PANEL_LEFT, sidebarOpen, { size: 16 });
 *   return <svg {...svgProps}><path {...pathProps} /></svg>;
 *
 * Why imperative and not <MorphIcon>: pi-work buttons are tiny 12–18 px
 * icons embedded in inline JSX (often inside other <button>s); wrapping
 * each in a stateful React component buys us nothing over a hook that
 * drives a ref'd <path>. The driver is also reentrant on prop changes,
 * so flipping active back and forth costs one morphTo() per flip.
 */

import { useEffect, useRef, useState } from "react";
import type { SVGAttributes } from "react";
import { createMorph } from "morphicons/dom";
import type { Morph, PathEl } from "morphicons/dom";
import type { SpringPreset } from "morphicons";

export type IconMorphSpring = SpringPreset; // "smooth" | "snappy" | "bouncy"
export type IconMorphReducedMotion = "never" | "user" | "always";

export interface IconMorphOptions {
  /** Physics preset for the morph. Default: "snappy". */
  spring?: IconMorphSpring;
  /** SVG width/height in px. Default: 16. */
  size?: number;
  /** SVG viewBox. Default: "0 0 24 24" (the Lucide grid). Override when the
   *  path data lives on a different grid (e.g. a 10×10 checkbox outline). */
  viewBox?: string;
  /** Stroke width on the <path>. Default: 2. */
  strokeWidth?: number;
  /** Morph even when the OS reduce-motion flag is on. Default: "never"
   *  (always animate, matching morphicons' default). */
  reducedMotion?: IconMorphReducedMotion;
  /** Forwarded to the <svg> className. */
  className?: string;
  /** Stroke color. Default: "currentColor". */
  color?: string;
}

export interface IconMorphBinding {
  svgProps: SVGAttributes<SVGSVGElement>;
  pathProps: { ref: (el: SVGPathElement | null) => void; d: string };
}

const DEFAULT_SPRING: IconMorphSpring = "snappy";

export function useIconMorph(
  fromD: string,
  toD: string,
  active: boolean,
  options: IconMorphOptions = {},
): IconMorphBinding {
  const {
    spring = DEFAULT_SPRING,
    size = 16,
    viewBox = "0 0 24 24",
    strokeWidth = 2,
    reducedMotion = "never",
    className,
    color = "currentColor",
  } = options;

  // Initial d is a function of the active prop — both server and client
  // compute the same string, so SSR emits the correct static icon and
  // hydration never rewrites the attribute. The driver takes over only
  // after mount.
  const initialD = active ? toD : fromD;
  const [d, setD] = useState(initialD);

  // Mirror props into refs so the driver-bearing effect doesn't re-run on
  // every render — the driver mutates `d` outside React, and we want the
  // morph call to follow the latest prop without recreating the instance.
  const pathRef = useRef<SVGPathElement | null>(null);
  const driverRef = useRef<Morph | null>(null);
  const deadRef = useRef(false);
  const fromRef = useRef(fromD);
  const toRef = useRef(toD);
  const activeRef = useRef(active);
  const springRef = useRef(spring);
  const rmRef = useRef(reducedMotion);
  fromRef.current = fromD;
  toRef.current = toD;
  activeRef.current = active;
  springRef.current = spring;
  rmRef.current = reducedMotion;

  // Driver birth + first morph. Runs once after mount: pick whichever
  // endpoint is current as the birth icon (no flight needed — the static
  // server render already shows it) and immediately morphTo the other
  // endpoint when fromD !== toD.
  useEffect(() => {
    deadRef.current = false;
    const el = pathRef.current;
    if (!el) return;
    const birth = activeRef.current ? toRef.current : fromRef.current;
    const driver = createMorph(el as PathEl, birth, { reducedMotion: rmRef.current });
    driverRef.current = driver;
    const target = activeRef.current ? toRef.current : fromRef.current;
    if (target !== birth) driver.morphTo(target, springRef.current);
    return () => {
      deadRef.current = true;
      driver.destroy();
      driverRef.current = null;
    };
  }, []);

  // Active flip → morph + sync React state so SSR-only consumers (rare)
  // still see the right d. The driver is the source of truth on screen;
  // the state write is for hydration parity if a future caller decides
  // to re-render before the rAF flushes.
  useEffect(() => {
    const driver = driverRef.current;
    if (!driver) return; // first effect owns the birth morph
    const target = active ? toD : fromD;
    setD(target);
    if (deadRef.current) return;
    driver.morphTo(target, spring);
    if (reducedMotion !== rmRef.current) {
      driver.reducedMotion = reducedMotion;
      rmRef.current = reducedMotion;
    }
  }, [active, fromD, toD, spring, reducedMotion]);

  const svgProps: SVGAttributes<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox,
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    className,
    style: { flexShrink: 0 },
  };

  return {
    svgProps,
    pathProps: {
      ref: (el: SVGPathElement | null) => {
        pathRef.current = el;
      },
      d,
    },
  };
}