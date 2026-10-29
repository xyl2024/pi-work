"use client";

/**
 * 图标偏好 (icon preference) client wiring.
 *
 * The preference is written from the models-config panel's provider detail page
 * but read by every icon consumer (chat toolbar, model picker, assistant
 * header, translate panel / bubble, scheduler). Those consumers each fetch
 * `/api/models` once on mount, so a write would otherwise only show up after a
 * remount. This module owns the one write call and a tiny notify/subscribe pair
 * so every mounted consumer can patch its existing state in place.
 *
 * Only successful writes broadcast — a failed PUT leaves every consumer on its
 * current view.
 */

import {
  normalizeModelIconPreferences,
  type ModelIconPreferences,
  MODEL_ICON_PREFERENCE_PROVIDER,
} from "@/lib/shared/model-icon-match";

/** The two states a model's icon can be in: auto-matched, or provider icon. */
export type ModelIconPreference = typeof MODEL_ICON_PREFERENCE_PROVIDER | "auto";

type Listener = (preferences: ModelIconPreferences) => void;

const listeners = new Set<Listener>();

/**
 * Subscribe to preference changes coming from a successful write. Listeners
 * receive the full canonical map, so they can replace their state outright.
 */
export function subscribeModelIconPreferences(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function broadcast(preferences: ModelIconPreferences): void {
  for (const listener of listeners) listener(preferences);
}

/**
 * Persist one model's preference, then notify every mounted consumer.
 * `"auto"` deletes the deviation server-side; `"provider"` pins the provider
 * icon. Throws (and broadcasts nothing) when the write fails.
 */
export async function saveModelIconPreference(
  provider: string,
  modelId: string,
  preference: ModelIconPreference,
): Promise<ModelIconPreferences> {
  const response = await fetch("/api/model-icon-preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, modelId, preference }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    preferences?: unknown;
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  const preferences = normalizeModelIconPreferences(data.preferences);
  broadcast(preferences);
  return preferences;
}
