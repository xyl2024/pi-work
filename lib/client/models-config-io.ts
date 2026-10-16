"use client";

/**
 * HTTP wiring shared by the models-config surfaces.
 *
 * Both the legacy modal holder (`hooks/useModelsConfig.ts`) and the panel store
 * (`lib/client/models-config-store.ts`) read and write the same endpoints. The
 * requests live here once so a contract change (a new field, a different error
 * shape) lands in one place instead of two; the two surfaces differ only in the
 * state they keep around the result.
 *
 * The modal holder is deleted in the收口 slice (#119); until then this module is
 * what keeps the split from duplicating the transport.
 */

import type { ApiKeyProvider, ModelsJson, OAuthProvider } from "@/lib/shared/models-config";

/**
 * Listeners told after every successful `PUT /api/models-config`.
 *
 * The shell subscribes to refresh new-session model defaults when the file is
 * actually written, instead of keying that off a modal close (which fired on
 * "open then cancel" too). Both surfaces — the panel store and the legacy
 * modal hook — go through `putModelsConfig`, so a save from either one lands
 * here and there is no second place to keep in sync.
 */
const savedListeners = new Set<() => void>();

/** Subscribe to successful saves; returns the unsubscribe. */
export function subscribeModelsConfigSaved(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

function notifyModelsConfigSaved(): void {
  for (const listener of savedListeners) listener();
}

/** GET the raw `models.json` payload (parsed, not yet normalized). */
export async function fetchModelsConfigPayload(): Promise<unknown> {
  const res = await fetch("/api/models-config");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

/** PUT the whole draft. Resolves `{ ok: false, error }` on an HTTP-level failure. */
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
