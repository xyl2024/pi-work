"use client";

import {
  normalizeModelIconPreferences,
  type ModelIconPreferences,
  type ModelIconPreference,
} from "@/lib/shared/model-icon-match";

type Listener = (preferences: ModelIconPreferences) => void;

const listeners = new Set<Listener>();

export function subscribeModelIconPreferences(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function broadcast(preferences: ModelIconPreferences): void {
  for (const listener of listeners) listener(preferences);
}

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
