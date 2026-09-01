"use client";

/**
 * "Six-Petal Spiral" loading animation, adapted from the math-curve-loader
 * demo (paidax01.github.io/math-curve-loaders). A spiraling comet draws a
 * six-petal hypotrochoid track while slowly breathing and rotating.
 *
 * The original drives everything off a `requestAnimationFrame` loop; this
 * component does the same but writes to the SVG DOM directly (path `d`,
 * particle cx/cy/r/opacity, group rotation) so it never re-renders React on
 * per-frame updates. It mounts/unmounts with the phase it represents, so the
 * rAF loop is fully cleaned up in the effect teardown.
 */

import { useEffect, useRef } from "react";

interface Config {
  particleCount: number;
  trailSpan: number;
  durationMs: number;
  rotationDurationMs: number;
  pulseDurationMs: number;
  strokeWidth: number;
  spiralR: number;
  spiralr: number;
  spirald: number;
  spiralScale: number;
  spiralBreath: number;
}

const CONFIG: Config = {
  particleCount: 43,
  trailSpan: 0.16,
  durationMs: 4600,
  rotationDurationMs: 41000,
  pulseDurationMs: 3400,
  strokeWidth: 3.6,
  spiralR: 7,
  spiralr: 1,
  spirald: 3.2,
  spiralScale: 3.35,
  spiralBreath: 0.7,
};

function normalizeProgress(progress: number) {
  return ((progress % 1) + 1) % 1;
}

/** Breathe factor (0.52..1) used to expand/contract the whole shape. */
function getDetailScale(time: number, c: Config) {
  const pulseProgress = (time % c.pulseDurationMs) / c.pulseDurationMs;
  const pulseAngle = pulseProgress * Math.PI * 2;
  return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
}

function getRotation(time: number, c: Config) {
  return -((time % c.rotationDurationMs) / c.rotationDurationMs) * 360;
}

/** Map a 0..1 progress value to an (x,y) on the six-petal curve. */
function point(progress: number, detailScale: number, c: Config) {
  const t = progress * Math.PI * 2;
  const d = c.spirald + detailScale * 0.25;
  const rMinusR = c.spiralR - c.spiralr;
  const ratio = rMinusR / c.spiralr;
  const baseX = rMinusR * Math.cos(t) + d * Math.cos(ratio * t);
  const baseY = rMinusR * Math.sin(t) - d * Math.sin(ratio * t);
  const scale = c.spiralScale + detailScale * c.spiralBreath;
  return { x: 50 + baseX * scale, y: 50 + baseY * scale };
}

/** Faint curved trail behind the leading comet. */
function buildPath(detailScale: number, c: Config, steps = 480) {
  let d = "";
  for (let index = 0; index <= steps; index++) {
    const p = point(index / steps, detailScale, c);
    d += `${index === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
  }
  return d.trim();
}

function getParticle(index: number, progress: number, detailScale: number, c: Config) {
  const tailOffset = index / (c.particleCount - 1);
  const p = point(normalizeProgress(progress - tailOffset * c.trailSpan), detailScale, c);
  const fade = Math.pow(1 - tailOffset, 0.56);
  return {
    x: p.x,
    y: p.y,
    radius: 0.9 + fade * 2.7,
    opacity: 0.04 + fade * 0.96,
  };
}

export function SixPetalSpiralLoader({ size = 220 }: { size?: number }) {
  const groupRef = useRef<SVGGElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const particlesRef = useRef<Array<SVGCircleElement | null>>([]);

  useEffect(() => {
    const group = groupRef.current;
    const path = pathRef.current;
    if (!group || !path) return;
    const circles = particlesRef.current;
    path.setAttribute("stroke-width", String(CONFIG.strokeWidth));

    const startedAt = performance.now();
    let raf = 0;
    const render = (now: number) => {
      const time = now - startedAt;
      const progress = (time % CONFIG.durationMs) / CONFIG.durationMs;
      const detailScale = getDetailScale(time, CONFIG);
      group.setAttribute("transform", `rotate(${getRotation(time, CONFIG)} 50 50)`);
      path.setAttribute("d", buildPath(detailScale, CONFIG));
      for (let i = 0; i < circles.length; i++) {
        const node = circles[i];
        if (!node) continue;
        const particle = getParticle(i, progress, detailScale, CONFIG);
        node.setAttribute("cx", particle.x.toFixed(2));
        node.setAttribute("cy", particle.y.toFixed(2));
        node.setAttribute("r", particle.radius.toFixed(2));
        node.setAttribute("opacity", particle.opacity.toFixed(3));
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        color: "var(--accent)",
      }}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        width={size}
        height={size}
        aria-hidden="true"
        style={{ overflow: "visible" }}
      >
        <g ref={groupRef}>
          <path
            ref={pathRef}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.1}
          />
          {Array.from({ length: CONFIG.particleCount }, (_, index) => (
            <circle
              key={index}
              ref={(node) => {
                particlesRef.current[index] = node;
              }}
              fill="currentColor"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
