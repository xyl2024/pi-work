"use client";

/**
 * GrokBot — animated SVG face companion, vendored from
 * https://github.com/zhulin025/LaoA-GrokBot (MIT License, Copyright (c) 2026 老A玩AI).
 *
 * Renders the bot's body (user-selectable shape + color), two eye outlines
 * (25 morphable expressions), optional body parts and accessories, and drives
 * all animation imperatively: a requestAnimationFrame loop interpolates the
 * eye rings with a spring, blinks on a per-state cadence, and follows the
 * pointer inside the stage. Playback state lives in refs (never triggers
 * React re-renders); the user's *configuration* (expression / state / color /
 * shape / parts / accessories) lives in the module store `lib/grokbot-store`
 * so the sidebar stage and the lab modal stay in sync.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useId,
} from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import {
  GROKBOT_EXPRESSIONS,
  GROKBOT_POOLS,
  GROKBOT_BLINK,
  GROKBOT_SHAPES,
  type GrokExpression,
  type GrokPoint,
} from "@/lib/grokbot-data";
import { useGrokbotConfig, setGrokbotConfig } from "@/lib/grokbot-store";

export interface GrokBotHandle {
  /** Pick an expression by index (0..24). Persists to the shared store. */
  setExpression(index: number): void;
  /** Enter a named state (see GROKBOT_STATE_NAMES). Persists to the store. */
  setState(stateKey: string): void;
  /** Play a one-shot jello action: bounce | shake | peek | pinch | squish | wave. */
  playQuickAction(action: string): void;
  /** Force a blink on the next frame. */
  triggerBlink(): void;
}

export interface GrokBotProps {
  /** CSS width of the svg (height follows the 229:229 viewBox). */
  size?: number;
  /** Follow the pointer inside the stage + blink on click. Default true. */
  interactive?: boolean;
  /** Extra class for the stage wrapper. */
  className?: string;
}

// ── Animation constants (from LaoA-GrokBot app.js) ───────────────────────

const EYE_CX = 114.2705;
const EYE_R = 105;

const STATE_MOTION_GROUPS: Record<string, string[]> = {
  bounce: ["excited", "happy", "laughing", "playful", "celebrate", "bouncing"],
  tilt: ["listening", "thinking", "curious", "confused", "shy", "dragging"],
  scan: ["searching", "working", "radar", "dictating", "writing", "uploading"],
  turn: ["orbit", "spawning", "sending", "receiving"],
  pulse: ["sleeping", "drowsy", "bored", "humming", "loading", "progress", "powering-down"],
};
const STATE_MOTION_FALLBACK = "glitch";

const QUICK_ACTION_DURATION: Record<string, number> = {
  bounce: 950,
  shake: 950,
  peek: 950,
  pinch: 1200,
  squish: 950,
  wave: 1350,
};

const ALL_BOT_CLASSES = [
  "grokbot-act-bounce",
  "grokbot-act-tilt",
  "grokbot-act-scan",
  "grokbot-act-turn",
  "grokbot-act-pulse",
  "grokbot-act-glitch",
  "grokbot-quick-bounce",
  "grokbot-quick-shake",
  "grokbot-quick-peek",
  "grokbot-quick-pinch",
  "grokbot-quick-squish",
  "grokbot-quick-wave",
];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const centroid = (ring: readonly GrokPoint[]): [number, number] => {
  let x = 0;
  let y = 0;
  const n = ring.length;
  for (const p of ring) {
    x += p[0] / n;
    y += p[1] / n;
  }
  return [x, y];
};

const ringPath = (ring: readonly GrokPoint[]): string =>
  "M" + ring.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("L") + "Z";

// Body-part / accessory path data (from index.html + enhancements.js).
const PART_PATHS: Record<string, ReactNode> = {
  antenna: (
    <>
      <path d="M114 18V-5" />
      <circle cx="114" cy="-12" r="8" />
    </>
  ),
  tail: <path d="M205 154C246 151 254 181 230 198C216 208 214 220 227 228" />,
  hands: (
    <>
      <g id="grokbot-hand-left">
        <path d="M25 132C5 136-8 148-17 165" />
        <circle cx="-20" cy="170" r="10" />
      </g>
      <g id="grokbot-hand-right" className="grokbot-hand-right">
        <path d="M204 132C224 136 237 148 246 165" />
        <circle cx="249" cy="170" r="10" />
      </g>
    </>
  ),
  feet: (
    <>
      <path d="M72 202V224" />
      <ellipse cx="62" cy="230" rx="24" ry="10" />
      <path d="M157 202V224" />
      <ellipse cx="167" cy="230" rx="24" ry="10" />
    </>
  ),
};

const ACCESSORY_FRONT: Record<string, ReactNode> = {
  "straw-hat": (
    <g className="grokbot-straw-hat">
      <path d="M63 28Q72-24 114-28Q156-24 165 28Z" />
      <ellipse cx="114" cy="31" rx="91" ry="18" />
      <path className="grokbot-hat-band" d="M64 10Q114 22 164 10L166 27Q114 38 62 27Z" />
    </g>
  ),
  glasses: (
    <g className="grokbot-glasses">
      <circle cx="72" cy="108" r="37" />
      <circle cx="157" cy="108" r="37" />
      <path d="M109 106Q114 99 120 106M35 102L12 94M194 102L217 94" />
    </g>
  ),
  bowtie: (
    <g className="grokbot-bowtie">
      <path d="M114 172L78 151Q62 143 64 176Q65 205 82 194L114 178Z" />
      <path d="M114 172L150 151Q166 143 164 176Q163 205 146 194L114 178Z" />
      <circle cx="114" cy="175" r="12" />
    </g>
  ),
};

function motionClassForState(stateKey: string): string {
  for (const [motion, states] of Object.entries(STATE_MOTION_GROUPS)) {
    if (states.includes(stateKey)) return `grokbot-act-${motion}`;
  }
  return `grokbot-act-${STATE_MOTION_FALLBACK}`;
}

export const GrokBot = forwardRef<GrokBotHandle, GrokBotProps>(function GrokBot(
  { size = "100%", interactive = true, className },
  ref,
) {
  const config = useGrokbotConfig();
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const eye0Ref = useRef<SVGPathElement>(null);
  const eye1Ref = useRef<SVGPathElement>(null);
  const bodyPathRef = useRef<SVGPathElement>(null);
  const clipPathRef = useRef<SVGPathElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  // Playback state (refs — never render-affecting).
  const anim = useRef({
    expression: 0,
    current: GROKBOT_EXPRESSIONS[0] as GrokExpression,
    target: GROKBOT_EXPRESSIONS[0] as GrokExpression,
    morph: 1,
    velocity: 0,
    last: 0,
    blinkStart: 0,
    gazeX: 0,
    gazeY: 0,
  });
  const timers = useRef({
    blink: null as ReturnType<typeof setTimeout> | null,
    stateMotion: null as ReturnType<typeof setTimeout> | null,
    quick: null as ReturnType<typeof setTimeout> | null,
  });
  const rafRef = useRef(0);
  const appliedRef = useRef<{ expression: number; stateKey: string } | null>(null);

  // ── Store → instance ──────────────────────────────────────────────────

  // Apply expression changes from the store (user picks, autoPlay, cadence).
  useEffect(() => {
    if (appliedRef.current?.expression === config.expression) return;
    appliedRef.current = { ...(appliedRef.current ?? { expression: -1, stateKey: "" }), expression: config.expression };
    const a = anim.current;
    a.current = a.target; // freeze interpolation at the current position
    a.target = GROKBOT_EXPRESSIONS[config.expression] ?? GROKBOT_EXPRESSIONS[0];
    a.expression = config.expression;
    a.morph = 0;
    a.velocity = 0;
  }, [config.expression]);

  // Apply state changes from the store: pick an expression from the state's
  // pool, play the state's motion class.
  const lastStateKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastStateKeyRef.current === config.stateKey) return;
    lastStateKeyRef.current = config.stateKey;
    const svg = svgRef.current;
    if (!svg) return;
    const pool = GROKBOT_POOLS[config.stateKey] ?? [0];
    const current = appliedRef.current?.expression ?? 0;
    const next = pool.find((i) => i !== current) ?? pool[0];
    if (next !== current) {
      // Route through the expression effect so both stay consistent.
      setGrokbotConfig({ expression: next });
    }
    // Motion class.
    const t = timers.current;
    if (t.stateMotion) clearTimeout(t.stateMotion);
    svg.classList.remove(...ALL_BOT_CLASSES);
    stageRef.current?.classList.remove("grokbot-guides");
    const cls = motionClassForState(config.stateKey);
    if (cls === "grokbot-act-turn") stageRef.current?.classList.add("grokbot-guides");
    svg.classList.add(cls);
    t.stateMotion = setTimeout(() => {
      svg.classList.remove(cls);
      stageRef.current?.classList.remove("grokbot-guides");
    }, 1100);
    // Blink cadence restarts for the new state.
    scheduleBlink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.stateKey]);

  // Body color follows `var(--accent)` via CSS; only shape / parts / accessories
  // are plain DOM updates.
  useEffect(() => {
    const shape = GROKBOT_SHAPES.find((s) => s.id === config.shapeId);
    if (shape) {
      bodyPathRef.current?.setAttribute("d", shape.path);
      clipPathRef.current?.setAttribute("d", shape.path);
    }
    const svg = svgRef.current;
    if (svg) {
      for (const part of ["hands", "feet", "tail", "antenna"]) {
        const el = svg.querySelector(`[data-part="${part}"]`);
        el?.classList.toggle("grokbot-enabled", config.parts.includes(part));
      }
      for (const acc of ["straw-hat", "glasses", "bowtie", "cape"]) {
        const el = svg.querySelector(`[data-accessory="${acc}"]`);
        el?.classList.toggle("grokbot-enabled", config.accessories.includes(acc));
      }
    }
  }, [config.shapeId, config.parts, config.accessories]);

  // ── Animation loop ────────────────────────────────────────────────────

  function blinkScale(now: number): number {
    const a = anim.current;
    if (!a.blinkStart) return 1;
    const t = (now - a.blinkStart) / 320;
    if (t >= 1) {
      a.blinkStart = 0;
      return 1;
    }
    return Math.max(t < 0.42 ? 1 - t / 0.42 : (t - 0.42) / 0.58, 0.04);
  }

  const scheduleBlink = () => {
    const t = timers.current;
    if (t.blink) clearTimeout(t.blink);
    const cadence = GROKBOT_BLINK[config.stateKey];
    if (!cadence) return;
    t.blink = setTimeout(() => {
      anim.current.blinkStart = performance.now();
      scheduleBlink();
    }, cadence[0] + Math.random() * (cadence[1] - cadence[0]));
  };

  useEffect(() => {
    const svg = svgRef.current;
    const eye0 = eye0Ref.current;
    const eye1 = eye1Ref.current;
    if (!svg || !eye0 || !eye1) return;
    const t = timers.current;

    const scheduleBlinkLocal = () => {
      if (t.blink) clearTimeout(t.blink);
      const cadence = GROKBOT_BLINK[config.stateKey];
      if (!cadence) return;
      t.blink = setTimeout(() => {
        anim.current.blinkStart = performance.now();
        scheduleBlinkLocal();
      }, cadence[0] + Math.random() * (cadence[1] - cadence[0]));
    };

    const a = anim.current;
    a.last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - a.last) / 1000, 0.1);
      a.last = now;
      // Spring toward morph = 1.
      a.velocity += (-14 * a.velocity - 49 * (a.morph - 1)) * dt;
      a.morph += a.velocity * dt;
      if (!Number.isFinite(a.morph)) {
        a.morph = 1;
        a.velocity = 0;
      }
      // Interpolated rings at the current morph position.
      const shown = a.current.map((ring, e) =>
        ring.map((p, i) => {
          const t = a.target[e][i];
          const m = clamp(a.morph, 0, 1);
          return [p[0] + (t[0] - p[0]) * m, p[1] + (t[1] - p[1]) * m] as GrokPoint;
        }),
      );
      const bs = blinkScale(now);
      const eyes = [eye0, eye1];
      shown.forEach((ring, i) => {
        const c = centroid(ring);
        const base = Math.asin(clamp((c[0] - EYE_CX) / EYE_R, -1, 1));
        const depth = Math.cos(base);
        const perspective = Math.max(depth, 0.02) / Math.max(Math.cos(base), 0.02);
        const x = EYE_CX + EYE_R * Math.sin(base) + a.gazeX;
        const y = c[1] + a.gazeY;
        const eye = eyes[i];
        eye.setAttribute("d", ringPath(ring));
        eye.setAttribute(
          "transform",
          `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${clamp(perspective, 0.02, 2.4).toFixed(3)} ${bs.toFixed(3)}) translate(${(-c[0]).toFixed(2)} ${(-c[1]).toFixed(2)})`,
        );
        eye.style.opacity = depth > 0.02 ? "1" : "0";
      });
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    scheduleBlinkLocal();
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (t.blink) clearTimeout(t.blink);
      if (t.stateMotion) clearTimeout(t.stateMotion);
      if (t.quick) clearTimeout(t.quick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pointer interaction ───────────────────────────────────────────────

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const box = stageRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const a = anim.current;
    a.gazeX = clamp(((e.clientX - box.left) / box.width) * 2 - 1, -0.6, 0.6) * 22;
    a.gazeY = clamp(((e.clientY - box.top) / box.height) * 2 - 1, -0.6, 0.6) * 14;
  };

  const handlePointerLeave = () => {
    anim.current.gazeX = 0;
    anim.current.gazeY = 0;
  };

  const handlePointerDown = () => {
    if (!interactive) return;
    anim.current.blinkStart = performance.now();
  };

  // ── Imperative API ────────────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    setExpression(index: number) {
      setGrokbotConfig({ expression: index });
    },
    setState(stateKey: string) {
      setGrokbotConfig({ stateKey });
    },
    playQuickAction(action: string) {
      const svg = svgRef.current;
      if (!svg) return;
      const t = timers.current;
      if (t.quick) clearTimeout(t.quick);
      svg.classList.remove(...ALL_BOT_CLASSES);
      stageRef.current?.classList.remove("grokbot-guides");
      // Restart CSS animation by forcing a reflow.
      void svg.getBoundingClientRect();
      const cls = `grokbot-quick-${action}`;
      svg.classList.add(cls);
      t.quick = setTimeout(
        () => {
          svg.classList.remove(cls);
          stageRef.current?.classList.remove("grokbot-guides");
        },
        QUICK_ACTION_DURATION[action] ?? 950,
      );
    },
    triggerBlink() {
      anim.current.blinkStart = performance.now();
    },
  }), []);

  const shapePath = GROKBOT_SHAPES.find((s) => s.id === config.shapeId)?.path ?? GROKBOT_SHAPES[0].path;

  return (
    <div
      ref={stageRef}
      className={`grokbot-stage${className ? ` ${className}` : ""}`}
      style={{ touchAction: "none" }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
    >
      <svg
        ref={svgRef}
        className="grokbot-bot"
        viewBox="-28 -28 285 285"
        style={{
          width: typeof size === "number" ? size : "100%",
          height: "auto",
          display: "block",
          margin: "0 auto",
          overflow: "visible",
          filter: "drop-shadow(0 10px 10px rgba(35,48,80,0.18))",
        }}
        role="img"
        aria-label="Pi Bot"
      >
        <defs>
          <clipPath id={`grokbot-head-clip-${uid}`}>
            <path ref={clipPathRef} d={shapePath} />
          </clipPath>
        </defs>
        <ellipse className="grokbot-orbit" cx="114" cy="115" rx="107" ry="38" />
        {/* Back accessories (cape) */}
        <g className="grokbot-accessory grokbot-back-accessory" data-accessory="cape">
          <path d="M25 79Q-2 119 13 210Q65 192 90 168Z" />
          <path d="M204 79Q231 119 216 210Q164 192 139 168Z" />
        </g>
        {/* Body parts */}
        {(["antenna", "tail", "hands", "feet"] as const).map((part) => (
          <g key={part} className="grokbot-body-part" data-part={part}>
            {PART_PATHS[part]}
          </g>
        ))}
        {/* Body */}
        <path ref={bodyPathRef} className="grokbot-body" d={shapePath} />
        {/* Eyes */}
        <g className="grokbot-eyes" clipPath={`url(#grokbot-head-clip-${uid})`}>
          <path ref={eye0Ref} className="grokbot-eye" />
          <path ref={eye1Ref} className="grokbot-eye" />
        </g>
        {/* Front accessories */}
        {(["straw-hat", "glasses", "bowtie"] as const).map((acc) => (
          <g key={acc} className="grokbot-accessory grokbot-front-accessory" data-accessory={acc}>
            {ACCESSORY_FRONT[acc]}
          </g>
        ))}
      </svg>
    </div>
  );
});
