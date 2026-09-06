"use client";

/**
 * CelebrationOverlay — full-screen, pointer-transparent canvas that plays the
 * `celebrate` tool's animation (confetti rain / party cannons / grand finale).
 *
 * Mounted once from `app/page.tsx`, portalled to <body> above every modal.
 * It subscribes to `lib/client/celebrate-store.ts`; each trigger spawns
 * particles and keeps a requestAnimationFrame loop alive until the show ends
 * (spawning stops at `endAt`, the loop stops when the sky is empty), so there
 * is zero cost while idle.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { subscribeCelebration } from "@/lib/client/celebrate-store";
import { playUiSoundEffect, playUiSoundEvent } from "@/lib/client/ui-sounds";
import { CANNON_BOOM } from "@/lib/client/celebrate-sounds";
import { CELEBRATE_DEFAULT_DURATION_MS, CELEBRATE_MAX_DURATION_MS, type CelebrateDetails } from "@/lib/shared/celebrate-tool-types";

const PALETTE = ["#ff5e5b", "#ffb400", "#00c2a8", "#4d8dff", "#c05cff", "#ff7ac8", "#7ae582", "#ffd23f", "#ff9f43"];

interface Confetti {
  kind: "confetti";
  x: number; y: number; vx: number; vy: number;
  w: number; h: number;
  rot: number; rotSpeed: number;
  flipPhase: number; flipSpeed: number;
  swayAmp: number; swayFreq: number; swayPhase: number;
  color: string; alpha: number; decay: number;
  gravity: number; drag: number;
}
type Particle = Confetti;

const CONFETTI_GRAVITY = 0.055;
const CONFETTI_DRAG = 0.992;
const CANNON_GRAVITY = 0.16;
const CANNON_DRAG = 0.988;

const CONCRETE_CELEBRATION_STYLES = ["confetti", "cannon", "grand"] as const;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function CelebrationOverlay() {
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // All animation state lives in refs — the component itself never re-renders
  // during a show).
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const spawnAccRef = useRef(0);
  const endAtRef = useRef(0);
  const activeStyleRef = useRef<CelebrateDetails["resolvedStyle"] | null>(null);

  useEffect(() => {
    setMounted(true);
    return subscribeCelebration((details) => {
      startShow(details);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ensureLoop(): void {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(tick);
  }

  function startShow(details: CelebrateDetails): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const endAt = performance.now() + clampDuration(details.durationMs);
    endAtRef.current = endAt;

    const style = details.resolvedStyle ?? pick(CONCRETE_CELEBRATION_STYLES);
    // Optional user-mapped sound (default silent; the style-synced SFX below
    // are the built-in audio for the show). Rapid re-triggers are deduped by
    // the player's min-gap, and autoplay policy is honored like other
    // UI-sound events (silent until the first user gesture unlocks audio).
    playUiSoundEvent("celebrate");
    // One cannon boom kicks off every show, regardless of visual style.
    playUiSoundEffect(CANNON_BOOM);
    // Layer the new celebration on top of a running one instead of clearing it.
    activeStyleRef.current = style;

    switch (style) {
      case "confetti":
        spawnConfetti(Math.round(Math.min(180, w / 8)), w);
        break;
      case "cannon":
        spawnCannonBurst(w, h, 90);
        break;
      case "grand":
        spawnConfetti(Math.round(Math.min(140, w / 10)), w);
        spawnCannonBurst(w, h, 70);
        break;
    }
    ensureLoop();
  }

  // ── spawners ────────────────────────────────────────────────────────────

  function spawnConfetti(count: number, w: number): void {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        kind: "confetti",
        x: rand(0, w),
        y: rand(-80, -10),
        vx: rand(-0.6, 0.6),
        vy: rand(1.6, 3.6),
        w: rand(6, 11),
        h: rand(4, 7),
        rot: rand(0, Math.PI * 2),
        rotSpeed: rand(-0.12, 0.12),
        flipPhase: rand(0, Math.PI * 2),
        flipSpeed: rand(0.08, 0.22),
        swayAmp: rand(0.4, 1.4),
        swayFreq: rand(0.01, 0.03),
        swayPhase: rand(0, Math.PI * 2),
        color: pick(PALETTE),
        alpha: 1,
        decay: 0,
        gravity: CONFETTI_GRAVITY,
        drag: CONFETTI_DRAG,
      });
    }
  }

  function spawnCannonBurst(w: number, h: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const fromLeft = i % 2 === 0;
      const x = fromLeft ? w * rand(0.02, 0.1) : w * rand(0.9, 0.98);
      const y = h - rand(4, 24);
      // Aim up and toward the center of the screen.
      const spread = rand(-0.28, 0.28);
      const baseAngle = fromLeft ? -Math.PI / 2 + 0.42 : -Math.PI / 2 - 0.42;
      const angle = baseAngle + spread;
      const speed = rand(11, 17);
      particlesRef.current.push({
        kind: "confetti",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: rand(5, 9),
        h: rand(3, 6),
        rot: rand(0, Math.PI * 2),
        rotSpeed: rand(-0.3, 0.3),
        flipPhase: rand(0, Math.PI * 2),
        flipSpeed: rand(0.15, 0.3),
        swayAmp: rand(0.3, 1),
        swayFreq: rand(0.02, 0.05),
        swayPhase: rand(0, Math.PI * 2),
        color: pick(PALETTE),
        alpha: 1,
        // Cannon pieces fade so lingering strays don't pile up on screen.
        decay: 0.0022,
        gravity: CANNON_GRAVITY,
        drag: CANNON_DRAG,
      });
    }
  }

  // ── main loop ───────────────────────────────────────────────────────────

  function tick(now: number): void {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      rafRef.current = null;
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const spawning = now < endAtRef.current;
    const style = activeStyleRef.current;

    // Continuous emission while the show is running.
    if (spawning && style) {
      if (style === "confetti" || style === "grand") {
        spawnAccRef.current += 1.6;
        while (spawnAccRef.current >= 1) {
          spawnAccRef.current -= 1;
          spawnConfetti(1, w);
        }
      }
      if (style === "cannon" || style === "grand") {
        spawnAccRef.current += 0.9;
        while (spawnAccRef.current >= 1) {
          spawnAccRef.current -= 1;
          spawnCannonBurst(w, h, 2);
        }
      }
    }

    ctx.clearRect(0, 0, w, h);
    const particles = particlesRef.current;
    let nextIdx = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.kind === "confetti") {
        p.vy = Math.min(p.vy * p.drag + p.gravity, 4.5);
        p.vx *= p.drag;
        p.swayPhase += p.swayFreq;
        p.x += p.vx + Math.sin(p.swayPhase) * p.swayAmp;
        p.y += p.vy;
        p.rot += p.rotSpeed;
        p.flipPhase += p.flipSpeed;
        p.alpha = Math.max(0, p.alpha - p.decay);
        if (p.y < h + 40 && p.alpha > 0.02) {
          particles[nextIdx++] = p;
          const scaleY = Math.abs(Math.cos(p.flipPhase));
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, (-p.h / 2) * Math.max(0.15, scaleY), p.w, p.h * Math.max(0.15, scaleY));
          ctx.restore();
        }
      }
    }
    particles.length = nextIdx;
    ctx.globalAlpha = 1;

    if (!spawning && particles.length === 0) {
      // Show over — park the loop; nothing renders until the next trigger.
      rafRef.current = null;
      activeStyleRef.current = null;
      ctx.clearRect(0, 0, w, h);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      particlesRef.current = [];
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 12000, pointerEvents: "none" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
    </div>,
    document.body,
  );
}

function clampDuration(ms: unknown): number {
  const n = typeof ms === "number" && Number.isFinite(ms) ? ms : CELEBRATE_DEFAULT_DURATION_MS;
  return Math.min(Math.max(Math.round(n), 1500), CELEBRATE_MAX_DURATION_MS);
}
