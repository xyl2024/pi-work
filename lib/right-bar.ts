// ── Client-safe right-bar config types + helpers ─────────────────────────
// Lives outside lib/config.ts because lib/config.ts is server-only
// (`fs`, `js-yaml`, the file logger) and gets pulled into the client bundle
// the moment a 'use client' component imports anything from it for runtime
// use. Types are erased at compile time so they're fine, but
// `isRightBarButtonVisible` is called at runtime in AppShell, so its host
// module must stay free of server-only imports.

// Persisted in ~/.pi-work/config.yaml under `right_side_bar` — one boolean
// per configurable id, plus an optional user-chosen display order. Both
// shapes are intentionally tolerant: missing id = visible (legacy files
// stay on their on-by-default defaults), missing `order` = the descriptor
// registry's default order.

export type RightBarButtonId =
  | "todos"
  | "canvas"
  | "translate"
  | "json"
  | "rss"
  | "favorites"
  | "tokens"
  | "toolCalls"
  | "gitDiff"
  | "conversationTree"
  | "terminal";

export interface RightSideBarConfig {
  /** Per-button show/hide flags. Missing keys default to true. */
  [key: string]: boolean | readonly RightBarButtonId[] | undefined;
  /**
   * Optional user-configured display order for the configurable buttons.
   * When absent the descriptor registry's default order is used. The
   * Settings modal edits this and the consumer (RightBarColumn) filters
   * stale entries on read.
   */
  order?: readonly RightBarButtonId[];
}

/** Per-button visibility predicate. Matches the consumer-side parser used
 *  in AppShell's auto-close effect and the descriptor-driven column render.
 *  Treating `cfg === null` as "show everything" preserves the conservative
 *  default for the first render before settings are fetched. */
export function isRightBarButtonVisible(
  cfg: RightSideBarConfig | null,
  id: string,
): boolean {
  if (cfg === null) return true;
  return (cfg as Record<string, unknown>)[id] !== false;
}
