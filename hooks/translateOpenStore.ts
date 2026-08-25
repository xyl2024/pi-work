"use client";

/**
 * Cross-component "open the translate tab" trigger.
 *
 * The text-selection toolbar lives inside ChatWindow and therefore
 * doesn't have a direct handle on AppShell's `handleOpenTranslateTab`.
 * Rather than threading yet another prop through AppShell →
 * WorkspaceChatTab → ChatWindow just for this gesture, we publish a
 * fire-and-forget event from the toolbar and let AppShell listen.
 *
 * Pair with `translateExternalInputStore` to also push the selected
 * text into the panel before the tab opens.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Fire the "open translate" trigger. Existing listeners (typically
 *  AppShell) handle the actual tab activation. */
export function fireTranslateOpened(): void {
  for (const l of listeners) l();
}

export function subscribeTranslateOpened(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
