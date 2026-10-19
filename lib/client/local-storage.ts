/**
 * Browser localStorage accessor shared by the small persistence modules
 * (`last-used-model.ts`, `last-settings-section.ts`).
 *
 * Returns null during SSR and when storage is unreachable — private mode, a
 * browser that throws on access — so callers degrade silently instead of
 * guarding the same `try` in every store.
 */
export function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
