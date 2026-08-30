// ── Last-used model persistence ────────────────────────────────────────
//
// Pi Work used to let new sessions fall back to the model that was last
// used (pi remembers it per cwd). The new-session pre-selection feature
// (commit c5a030b) changed this to force the global default from
// `~/.pi/agent/settings.json` on every new session, overriding that
// behaviour. This module restores the old UX: we remember the model the
// user actually last used and default new sessions to it, falling back to
// the settings default when nothing has been recorded yet.
//
// Deliberately small string-only payload — JSON.stringify + JSON.parse
// both directions. Fails silently (no store / private mode / corrupt
// value) just like the other Pi Work localStorage layers.

const LAST_USED_MODEL_KEY = "pi-work:last-used-model";

export interface LastUsedModel {
  provider: string;
  modelId: string;
}

/** Test/storage isolation hook — mirrors other Pi Work storage layers so
 *  tests can override it without touching the public API. */
export function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Read the last-used model. Returns `null` when localStorage is
 *  unavailable, the key is missing, or the value is corrupt. */
export function readLastUsedModel(): LastUsedModel | null {
  const store = getStorage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(LAST_USED_MODEL_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const v = parsed as Record<string, unknown>;
    if (typeof v.provider !== "string" || typeof v.modelId !== "string") return null;
    return { provider: v.provider, modelId: v.modelId };
  } catch {
    return null;
  }
}

/** Persist the last-used model. Best-effort — write failures (private
 *  mode, quota) are swallowed and never crash the caller. */
export function writeLastUsedModel(next: LastUsedModel): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setItem(LAST_USED_MODEL_KEY, JSON.stringify(next));
  } catch (error) {
    if (typeof console !== "undefined") {
      console.warn("[last-used-model] write failed", error);
    }
  }
}