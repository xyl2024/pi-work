"use client";

import { useEffect, useRef, useState } from "react";
import type { SVGAttributes } from "react";
import { createMorph } from "morphicons/dom";
import type { Morph, PathEl } from "morphicons/dom";
import type { SpringPreset } from "morphicons";

export type IconMorphSpring = SpringPreset;
export type IconMorphReducedMotion = "never" | "user" | "always";

export interface IconMorphOptions {
  spring?: IconMorphSpring;
  size?: number;
  viewBox?: string;
  strokeWidth?: number;
  reducedMotion?: IconMorphReducedMotion;
  className?: string;
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

  const initialD = active ? toD : fromD;
  const [d, setD] = useState(initialD);

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

  useEffect(() => {
    const driver = driverRef.current;
    if (!driver) return;
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