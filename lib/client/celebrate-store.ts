"use client";

/**
 * Event queue for the `celebrate` tool's frontend animation.
 *
 * `useAgentSession`'s `tool_execution_end` handler calls `triggerCelebration`
 * with the tool result details (deduped by toolCallId against SSE replays).
 * `components/effects/CelebrationOverlay.tsx` subscribes and plays each
 * celebration. Runtime-only, not persisted.
 */

import type { CelebrateDetails } from "@/lib/shared/celebrate-tool-types";

const listeners = new Set<(details: CelebrateDetails) => void>();

export function subscribeCelebration(cb: (details: CelebrateDetails) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Fire one celebration in the overlay. Idempotent-safe; replays are deduped by the caller. */
export function triggerCelebration(details: CelebrateDetails | null | undefined): void {
  if (!details || typeof details !== "object") return;
  for (const cb of listeners) {
    try {
      cb(details);
    } catch {
      // A broken listener must not take the SSE handler down.
    }
  }
}
