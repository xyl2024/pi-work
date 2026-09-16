// ── Plans panel appearance mode persistence (#48) ────────────────────────
//
// The three appearance modes (紧凑 / 卡片 / 时间轴) are a browser-local
// preference, not a plan field: the mode changes how the panel renders, never
// what it lists (ADR-0006). Stored as a bare string under
// `pi-work.plans.view-mode`; a missing, unreadable or unknown value falls back
// to `compact` rather than breaking the panel.
//
// Deliberately tiny and string-only, like the other Pi Work localStorage
// layers, and best-effort in both directions (no store / private mode / quota
// — the panel keeps rendering with whatever is in memory).

import {
  DEFAULT_PLAN_VIEW_MODE,
  parsePlanViewMode,
  type PlanViewMode,
} from "@/lib/shared/plans";

export const PLAN_VIEW_MODE_STORAGE_KEY = "pi-work.plans.view-mode";

/** Test/storage isolation hook — mirrors the other Pi Work storage layers so
 *  tests can override it without touching the public API. */
export function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The stored mode, or `compact` when nothing usable is stored. */
export function readPlanViewMode(): PlanViewMode {
  const store = getStorage();
  if (!store) return DEFAULT_PLAN_VIEW_MODE;
  try {
    return parsePlanViewMode(store.getItem(PLAN_VIEW_MODE_STORAGE_KEY)) ?? DEFAULT_PLAN_VIEW_MODE;
  } catch {
    return DEFAULT_PLAN_VIEW_MODE;
  }
}

/** Persist the chosen mode. Best-effort — a write failure is swallowed. */
export function writePlanViewMode(mode: PlanViewMode): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setItem(PLAN_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    /* private mode / quota — the in-memory choice still applies */
  }
}
