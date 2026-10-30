"use client";

import type { ApiKeyProvider, ModelsJson, OAuthProvider } from "@/lib/shared/models-config";

const savedListeners = new Set<() => void>();

export function subscribeModelsConfigSaved(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

function notifyModelsConfigSaved(): void {
  for (const listener of savedListeners) listener();
}

export async function fetchModelsConfigPayload(): Promise<unknown> {
  const res = await fetch("/api/models-config");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

export async function putModelsConfig(config: ModelsJson): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/models-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const body = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || body.error) {
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  notifyModelsConfigSaved();
  return { ok: true };
}

export async function fetchOAuthProviders(): Promise<OAuthProvider[]> {
  const res = await fetch("/api/auth/providers");
  const body = (await res.json()) as { providers?: OAuthProvider[] };
  return body.providers ?? [];
}

export async function fetchApiKeyProviders(): Promise<ApiKeyProvider[]> {
  const res = await fetch("/api/auth/all-providers");
  const body = (await res.json()) as { providers?: ApiKeyProvider[] };
  return body.providers ?? [];
}
