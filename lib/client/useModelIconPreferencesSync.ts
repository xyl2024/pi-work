"use client";

import { useEffect } from "react";
import { subscribeModelIconPreferences } from "@/lib/client/model-icon-preferences";
import type { ModelIconPreferences } from "@/lib/shared/model-icon-match";

export function useModelIconPreferencesSync(
  apply: (preferences: ModelIconPreferences) => void,
): void {
  useEffect(() => subscribeModelIconPreferences(apply), [apply]);
}
