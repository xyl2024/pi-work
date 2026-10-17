"use client";

/**
 * Display-only path shortening for the UI.
 *
 * Collapses `/Users/<name>/…` and `/home/<name>/…` to `~` so a working
 * directory fits in a chip. Never used for filesystem access.
 */
export function shortenPath(p: string): string {
  // Match common home dir patterns: /Users/xxx, /home/xxx
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
