"use client";

import { useSyncExternalStore } from "react";
import type { SubagentBotAppearance } from "@/lib/shared/subagent";
import {
  GROKBOT_EXPRESSIONS,
  GROKBOT_GROUPS,
  GROKBOT_POOLS,
  GROKBOT_EXPR_CADENCE,
  GROKBOT_SHAPES,
  GROKBOT_DEFAULT_SHAPE_ID,
} from "@/lib/client/grokbot-data";

export interface GrokbotConfig extends SubagentBotAppearance {
  colorId?: string;
  autoPlay: boolean;
}

const STORAGE_KEY = "pi-work.grokbot.config";

const DEFAULT_CONFIG: GrokbotConfig = {
  expression: 0,
  stateKey: "idle",
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
  if (typeof c.shapeId !== "string") return false;
  if (!Array.isArray(c.parts) || !Array.isArray(c.accessories)) return false;
  if (typeof c.autoPlay !== "boolean") return false;
  return (
    c.expression >= 0 &&
    c.expression < GROKBOT_EXPRESSIONS.length &&
    GROKBOT_POOLS[c.stateKey] !== undefined &&
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
  }
}

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

export function setGrokbotConfig(patch: Partial<GrokbotConfig>): void {
  const { colorId: _colorId, ...rest } = patch;
  void _colorId;
  const next = { ...state, ...rest };
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

export function randomizeGrokbot(): void {
  const states = ALL_STATES;
  const shape = GROKBOT_SHAPES[Math.floor(Math.random() * GROKBOT_SHAPES.length)];
  const parts = ["hands", "feet", "tail", "antenna"].filter(() => Math.random() < 0.42);
  setGrokbotConfig({
    shapeId: shape.id,
    parts,
    accessories: [],
    stateKey: states[Math.floor(Math.random() * states.length)],
    expression: Math.floor(Math.random() * GROKBOT_EXPRESSIONS.length),
  });
}

function subscribeGrokbot(cb: () => void): () => void {
  listeners.add(cb);
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
