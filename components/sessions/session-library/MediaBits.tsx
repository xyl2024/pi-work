"use client";

/**
 * Shared bits for the Session Media Library (grid tiles + theater
 * filmstrip / audio art). Everything here is self-contained so both
 * `SessionLibraryGrid` and `SessionLibraryPreview` can use the same
 * gradient covers, duration badges, equalizer bars, and lazy-loading
 * hooks without duplicating logic.
 */

import { useEffect, useRef, useState } from "react";

/** Deterministic two-stop gradient for audio covers: hash the path →
 *  derive a hue so every audio file gets its own stable "album art". */
export function gradientFromPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 58% 44%), hsl(${(hue + 50) % 360} 62% 22%))`;
}

/** Format seconds → "m:ss". Returns "" when the duration is unknown. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Small bottom-right pill showing a media duration; hidden when unknown. */
export function DurationBadge({
  seconds,
}: {
  seconds: number | null | undefined;
}) {
  const label = fmtDuration(seconds);
  if (!label) return null;
  return (
    <span
      style={{
        position: "absolute",
        right: 6,
        bottom: 6,
        zIndex: 2,
        padding: "1px 7px",
        borderRadius: 999,
        background: "rgba(0,0,0,0.68)",
        color: "#fff",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        pointerEvents: "none",
        letterSpacing: 0.3,
      }}
    >
      {label}
    </span>
  );
}

/**
 * Animated equalizer bars. `playing` drives a scaleY pulse; when paused
 * the bars sit at a static short height so the tile still reads as
 * "audio" without animating a wall of tiles.
 */
export function EqualizerBars({
  playing,
  barCount = 5,
  width = 36,
  height = 26,
}: {
  playing: boolean;
  barCount?: number;
  width?: number;
  height?: number;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 3,
        height,
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: barCount }, (_, i) => (
        <span
          key={i}
          className="sl-eq-bar"
          style={{
            width: Math.max(2, width / barCount - 3),
            height: "100%",
            borderRadius: 2,
            background: "rgba(255,255,255,0.92)",
            transformOrigin: "bottom",
            transform: playing ? undefined : "scaleY(0.3)",
            animation: playing
              ? `sl-eq-pulse 1.1s ease-in-out infinite ${i * 0.12}s`
              : "none",
          }}
        />
      ))}
    </div>
  );
}

/**
 * One-shot viewport observer: reports true once the element has entered
 * the viewport (with `rootMargin` headroom) and then disconnects. Used
 * to defer `<video preload="metadata">` / duration fetches until the
 * tile is actually visible — keeps long sessions from firing dozens of
 * media requests on mount.
 */
export function useInView<T extends Element>(rootMargin = "240px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
          }
        }
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin]);
  return [ref, inView] as const;
}

/**
 * Load a media file's duration via a detached element. Only starts
 * fetching when `src` is set (pass `inView ? url : undefined`).
 * Returns null while unknown / on error.
 */
export function useMediaDuration(
  src: string | undefined,
  kind: "audio" | "video",
): number | null {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    if (!src) return;
    setDuration(null);
    const el = document.createElement(kind);
    el.preload = "metadata";
    const onLoaded = () => {
      setDuration(Number.isFinite(el.duration) ? el.duration : null);
    };
    const onError = () => setDuration(null);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("error", onError);
    el.src = src;
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("error", onError);
      el.removeAttribute("src");
      el.load();
    };
  }, [src, kind]);
  return duration;
}

// Equalizer keyframes — injected once per page load, guarded by a flag.
let styleInjected = false;
function injectMediaBitsStyles() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-source", "session-library-bits");
  style.textContent = `
    @keyframes sl-eq-pulse {
      0%, 100% { transform: scaleY(0.2); }
      50% { transform: scaleY(1); }
    }
  `;
  document.head.appendChild(style);
}
injectMediaBitsStyles();
