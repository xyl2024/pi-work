"use client";

import { useEffect } from "react";
import { subscribeModelIconPreferences } from "@/lib/client/model-icon-preferences";
import type { ModelIconPreferences } from "@/lib/shared/model-icon-match";

/**
 * Patch a cached 图标偏好 (icon preference) map in place when a toggle writes a
 * new one.
 *
 * Every icon consumer fetches `/api/models` once on mount; a preference write
 * from the models-config panel would otherwise only show up after a remount.
 * `apply` is usually a state setter (stable), so the effect subscribes once.
 * Non-React singletons (lib/client/scheduler-store.ts) subscribe directly.
 */
export function useModelIconPreferencesSync(
  apply: (preferences: ModelIconPreferences) => void,
): void {
  useEffect(() => subscribeModelIconPreferences(apply), [apply]);
}
