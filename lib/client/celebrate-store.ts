"use client";

import type { CelebrateDetails } from "@/lib/shared/celebrate-tool-types";

const listeners = new Set<(details: CelebrateDetails) => void>();

export function subscribeCelebration(cb: (details: CelebrateDetails) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function triggerCelebration(details: CelebrateDetails | null | undefined): void {
  if (!details || typeof details !== "object") return;
  for (const cb of listeners) {
    try {
      cb(details);
    } catch {
    }
  }
}
