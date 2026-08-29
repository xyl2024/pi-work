"use client";

/**
 * Cross-component "open the translate bubble" trigger + state.
 *
 * Replaces the previous `translateOpenStore` / `translateExternalInputStore`
 * flow used for the right-side TranslatePanel: instead of opening a side
 * panel, the chat text-selection toolbar's `toChinese` / `toEnglish`
 * buttons now publish a TranslateBubbleSnapshot here and a single
 * `<TranslateBubble />` instance (mounted inside ChatWindow) renders it
 * as a floating popover anchored to the selection rect.
 *
 * Model selection, output streaming, and error handling live inside the
 * bubble component itself — the store only carries the *intent*: which
 * direction, what source text, and where to anchor the popover. The
 * bubble watches `requestSeq` to know when to restart its stream (a
 * second click on the same direction is treated as a retranslate /
 * cancel-and-restart gesture).
 *
 * Single-instance by design: opening a new bubble replaces the prior
 * snapshot rather than queuing. The bubble owns the abort wiring, so a
 * fresh `open()` simply bumps the seq and the in-flight request gets
 * aborted in the next render.
 */
import type { LanguageCode } from "@/lib/shared/translate";

export interface TranslateBubbleAnchor {
  /** Viewport-space top of the topmost row of the selection. */
  top: number;
  /** Viewport-space center-x of the topmost row. */
  centerX: number;
  /** Width of the topmost row (for size hints; not used to clamp). */
  width: number;
}

export interface TranslateBubbleSnapshot {
  open: boolean;
  /** Target language picked by the toolbar button that opened the bubble. */
  direction: LanguageCode;
  /** Source text to translate. */
  sourceText: string;
  /** Anchor point captured at open-time; positioned once and not re-derived. */
  anchorRect: TranslateBubbleAnchor | null;
  /** Monotonic counter bumped on every `open()` call. The bubble uses this
   *  to know when to abort a prior request and re-stream. */
  requestSeq: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: TranslateBubbleSnapshot = {
  open: false,
  direction: "zh",
  sourceText: "",
  anchorRect: null,
  requestSeq: 0,
};

function notify(): void {
  for (const l of listeners) l();
}

/** Open (or replace) the bubble for the given direction. Bumps
 *  `requestSeq` so the bubble aborts any in-flight stream and starts
 *  fresh. Passing an empty `sourceText` is a no-op (it cannot translate
 *  nothing); the caller is expected to guard the toolbar against that. */
export function openTranslateBubble(
  direction: LanguageCode,
  sourceText: string,
  anchorRect: TranslateBubbleAnchor,
): void {
  if (!sourceText) return;
  snapshot = {
    open: true,
    direction,
    sourceText,
    anchorRect,
    requestSeq: snapshot.requestSeq + 1,
  };
  notify();
}

/** Close the bubble. The bubble itself also calls this when the user
 *  presses Esc / the X button, so any other listener (analytics, etc.)
 *  can react. */
export function closeTranslateBubble(): void {
  if (!snapshot.open) return;
  snapshot = {
    open: false,
    direction: snapshot.direction,
    sourceText: snapshot.sourceText,
    anchorRect: snapshot.anchorRect,
    requestSeq: snapshot.requestSeq,
  };
  notify();
}

/** Synchronous getter for the bubble component to read the current
 *  state once per render without having to keep it in React state. */
export function getTranslateBubbleSnapshot(): TranslateBubbleSnapshot {
  return snapshot;
}

/** Subscribe to store changes. Returns an unsubscribe fn. The
 *  subscriber is invoked synchronously on every `open` / `close`, so
 *  the bubble re-reads `getTranslateBubbleSnapshot()` in its handler
 *  (cheap — it's just an object reference). */
export function subscribeTranslateBubble(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
