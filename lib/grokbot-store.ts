"use client";

import { useSyncExternalStore } from "react";
import {
  GROKBOT_EXPRESSIONS,
  GROKBOT_GROUPS,
  GROKBOT_POOLS,
  GROKBOT_EXPR_CADENCE,
  GROKBOT_COLORS,
  GROKBOT_SHAPES,
  GROKBOT_DEFAULT_COLOR_ID,
  GROKBOT_DEFAULT_SHAPE_ID,
} from "@/lib/grokbot-data";

/**
 * Module-scoped store for the GrokBot companion in the left sidebar.
 *
 * The sidebar stage and the GrokBot Lab modal each mount their own animated
 * `<GrokBot/>` instance; this store is the single source of truth for the
 * *user's* configuration (expression, state, color, shape, parts,
 * accessories) so both instances stay in sync. Animation playback (morph,
 * blink, gaze, quick actions) is per-instance and does not live here.
 *
 * Two module-level timers drive state transitions so they never duplicate:
 *  - autoPlay  — "tour mode", cycles through all 39 states every 2.2s.
 *  - cadence   — inside a state, swaps the expression at the state's own
 *                pace (GROKBOT_EXPR_CADENCE) so the bot feels alive.
 * Only one timer of each kind exists, regardless of how many GrokBot
 * instances are mounted.
 *
 * Persisted to localStorage under `pi-work.grokbot.config`.
 */

export interface GrokbotConfig {
  /** Index into GROKBOT_EXPRESSIONS. */
  expression: number;
  /** Key into GROKBOT_POOLS / GROKBOT_STATE_NAMES, e.g. "idle". */
  stateKey: string;
  colorId: string;
  shapeId: string;
  /** Enabled body-part ids (hands/feet/tail/antenna). */
  parts: string[];
  /** Enabled accessory ids (straw-hat/glasses/bowtie/cape). */
  accessories: string[];
  /** Auto-tour through every state. */
  autoPlay: boolean;
}

const STORAGE_KEY = "pi-work.grokbot.config";

const DEFAULT_CONFIG: GrokbotConfig = {
  expression: 0,
  stateKey: "idle",
  colorId: GROKBOT_DEFAULT_COLOR_ID,
  shapeId: GROKBOT_DEFAULT_SHAPE_ID,
  parts: [],
  accessories: [],
  autoPlay: false,
};

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function isConfig(v: unknown): v is GrokbotConfig {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  if (typeof c.expression !== "number" || typeof c.stateKey !== "string") return false;
  if (typeof c.colorId !== "string" || typeof c.shapeId !== "string") return false;
  if (!Array.isArray(c.parts) || !Array.isArray(c.accessories)) return false;
  if (typeof c.autoPlay !== "boolean") return false;
  return (
    c.expression >= 0 &&
    c.expression < GROKBOT_EXPRESSIONS.length &&
    GROKBOT_POOLS[c.stateKey] !== undefined &&
    GROKBOT_COLORS.some((col) => col.id === c.colorId) &&
    GROKBOT_SHAPES.some((s) => s.id === c.shapeId)
  );
}

function loadConfig(): GrokbotConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed: unknown = JSON.parse(raw);
    return isConfig(parsed) ? parsed : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

let state: GrokbotConfig = loadConfig();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore (private mode / quota)
  }
}

// ── Module-level timers ──────────────────────────────────────────────────

const ALL_STATES = Object.values(GROKBOT_GROUPS).flat();
let autoPlayTimer: ReturnType<typeof setInterval> | null = null;
let cadenceTimer: ReturnType<typeof setTimeout> | null = null;

function stopCadence() {
  if (cadenceTimer !== null) {
    clearTimeout(cadenceTimer);
    cadenceTimer = null;
  }
}

function scheduleCadence() {
  stopCadence();
  if (state.autoPlay) return;
  const cadence = GROKBOT_EXPR_CADENCE[state.stateKey];
  if (!cadence) return;
  const pool = GROKBOT_POOLS[state.stateKey];
  if (!pool || pool.length < 2) return;
  cadenceTimer = setTimeout(() => {
    cadenceTimer = null;
    if (state.autoPlay) return;
    const next = pool[Math.floor(Math.random() * pool.length)];
    if (next !== state.expression) {
      state = { ...state, expression: next };
      persist();
      emit();
    }
    scheduleCadence();
  }, rand(cadence[0], cadence[1]));
}

function syncAutoPlayTimer() {
  if (state.autoPlay && autoPlayTimer === null) {
    stopCadence();
    let i = ALL_STATES.indexOf(state.stateKey);
    if (i === -1) i = 0;
    autoPlayTimer = setInterval(() => {
      i = (i + 1) % ALL_STATES.length;
      const next = ALL_STATES[i];
      if (next !== state.stateKey) {
        state = { ...state, stateKey: next };
        persist();
        emit();
      }
    }, 2200);
  } else if (!state.autoPlay && autoPlayTimer !== null) {
    clearInterval(autoPlayTimer);
    autoPlayTimer = null;
    scheduleCadence();
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export function getGrokbotConfig(): GrokbotConfig {
  return state;
}

export function setGrokbotConfig(patch: Partial<GrokbotConfig>): void {
  const next = { ...state, ...patch };
  if (next.expression < 0 || next.expression >= GROKBOT_EXPRESSIONS.length) {
    next.expression = DEFAULT_CONFIG.expression;
  }
  if (GROKBOT_POOLS[next.stateKey] === undefined) {
    next.stateKey = DEFAULT_CONFIG.stateKey;
  }
  state = next;
  persist();
  if (patch.autoPlay !== undefined) {
    syncAutoPlayTimer();
  } else {
    scheduleCadence();
  }
  emit();
}

/** Fully randomize color / shape / state / expression / parts. */
export function randomizeGrokbot(): void {
  const states = ALL_STATES;
  const color = GROKBOT_COLORS[Math.floor(Math.random() * GROKBOT_COLORS.length)];
  const shape = GROKBOT_SHAPES[Math.floor(Math.random() * GROKBOT_SHAPES.length)];
  const parts = ["hands", "feet", "tail", "antenna"].filter(() => Math.random() < 0.42);
  setGrokbotConfig({
    colorId: color.id,
    shapeId: shape.id,
    parts,
    accessories: [],
    stateKey: states[Math.floor(Math.random() * states.length)],
    expression: Math.floor(Math.random() * GROKBOT_EXPRESSIONS.length),
  });
}

function subscribeGrokbot(cb: () => void): () => void {
  listeners.add(cb);
  // Lazy module timer bootstrap: when the first consumer subscribes (i.e. a
  // GrokBot is actually mounted), start the state's cadence if needed.
  scheduleCadence();
  syncAutoPlayTimer();
  return () => {
    listeners.delete(cb);
  };
}

function getGrokbotSnapshot(): GrokbotConfig {
  return state;
}

function getGrokbotServerSnapshot(): GrokbotConfig {
  return DEFAULT_CONFIG;
}

export function useGrokbotConfig(): GrokbotConfig {
  return useSyncExternalStore(subscribeGrokbot, getGrokbotSnapshot, getGrokbotServerSnapshot);
}
