"use client";

/**
 * Cross-component "set the translate panel's input" channel.
 *
 * TranslatePanel owns its `input` as local state — there's no store
 * today — but the chat text-selection toolbar needs a way to push a
 * freshly-selected snippet into the panel after it has been opened.
 * Threading an `initialText` prop through AppShell would couple the
 * panel to the toolbar's lifetime; a small module-level channel
 * decouples them: the toolbar publishes, the panel subscribes.
 *
 * The pending text is single-slot (a ref + a notify) because at most
 * one "open translate with this text" gesture is in flight at a time.
 *
 * Optional `target` lets the publisher also pin the *target language*
 * for this gesture (e.g. "translate this selection into Chinese"),
 * which TranslatePanel uses to auto-fire the request without having
 * to mutate the user's persisted `target` preference. If omitted,
 * the panel just runs against whatever target it already has.
 */
import type { LanguageCode } from "@/lib/shared/translate";

export interface TranslatePendingInput {
  text: string;
  /** One-shot target language override; TranslatePanel consumes it but
   *  does NOT write it back to its `target` state, so the user's
   *  saved preference (and the toggle button label) is unaffected. */
  target?: LanguageCode;
}

type Listener = (input: TranslatePendingInput) => void;

let pending: TranslatePendingInput | null = null;
const listeners = new Set<Listener>();

/** Publish text for the next mount of TranslatePanel to consume. If a
 *  text is already pending, the new value replaces it (the most recent
 *  gesture wins). */
export function setTranslatePendingInput(input: TranslatePendingInput | string): void {
  pending = typeof input === "string" ? { text: input } : input;
  for (const l of listeners) l(pending);
}

/** Drain the current pending text. Called by TranslatePanel on mount
 *  / when it observes a non-null value, so the same text is not
 *  re-applied if the panel remounts due to a tab switch later. */
export function consumeTranslatePendingInput(): TranslatePendingInput | null {
  const v = pending;
  pending = null;
  return v;
}

/** Subscribe to pending-input changes. Returns an unsubscribe fn.
 *  The subscriber is *also* invoked synchronously with the current
 *  pending value on subscribe, so a freshly-mounted panel picks up
 *  text that was published before it existed. */
export function subscribeTranslatePendingInput(l: Listener): () => void {
  listeners.add(l);
  if (pending !== null) l(pending);
  return () => { listeners.delete(l); };
}
