/**
 * Single-path `d` strings consumed by `useIconMorph`.
 *
 * morphicons only mutates the `d` attribute of one <path> element, so every
 * icon here is a single compound `d` string (multiple subpaths joined with
 * `M` / `Z`). Existing inline SVGs that mix `<rect>` / `<line>` / `<polyline>`
 * are flattened manually — keep the conversion deterministic by using the
 * formulas in the file header of each entry. All paths live on the Lucide
 * 24×24 grid so morph alignment (Procrustes) can find a clean rotation when
 * one exists.
 *
 * This module is pure data; the runtime hook lives at
 * `hooks/useIconMorph.ts`.
 */

/** Panel-left icon: rounded rect with a vertical divider on the left third.
 *  Source: <rect x="3" y="3" width="18" height="18" rx="2"/> + <line x1="9" y1="3" x2="9" y2="21"/> */
export const PANEL_LEFT =
  "M 5 3 H 19 A 2 2 0 0 1 21 5 V 19 A 2 2 0 0 1 19 21 H 5 A 2 2 0 0 1 3 19 V 5 A 2 2 0 0 1 5 3 Z M 9 3 V 21";

/** Hamburger menu: three horizontal lines stacked at y=6/12/18.
 *  Source: 3 × <line x1="3" y1={6|12|18} x2="21" y2={6|12|18}/> */
export const MENU =
  "M 3 6 H 21 M 3 12 H 21 M 3 18 H 21";

/** Copy icon (default copy button). Two subpaths: the front rounded rect
 *  and the back tab. Source:
 *    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
 *    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/> */
export const COPY =
  "M 11 9 H 20 A 2 2 0 0 1 22 11 V 20 A 2 2 0 0 1 20 22 H 11 A 2 2 0 0 1 9 20 V 11 A 2 2 0 0 1 11 9 Z M 5 15 H 4 A 2 2 0 0 1 2 13 V 4 A 2 2 0 0 1 4 2 H 13 A 2 2 0 0 1 15 4 V 5";

/** Check icon (post-copy success). Single subpath: a 3-point polyline
 *  going from top-right down-left then up-left.
 *  Source: <polyline points="20 6 9 17 4 12"/> */
export const CHECK = "M 20 6 L 9 17 L 4 12";

/** Refresh icon (counter-clockwise circular arrow with a tail arrowhead).
 *  Two subpaths joined with `M`. Source:
 *    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
 *    <path d="M3 3v5h5"/> */
export const REFRESH =
  "M 3 12 A 9 9 0 1 0 12 3 A 9.75 9.75 0 0 0 5.26 5.74 L 3 8 M 3 3 V 8 H 8";

/** Chevrons-up (collapse all): two stacked chevrons pointing up — the
 *  standard "collapse every level" glyph in file-tree UIs (VS Code's
 *  explorer uses the same shape). Single chevron folds one level, two
 *  chevrons fold every level. Source: 2 ×
 *  <polyline points="17 11 12 6 7 11"/> / <polyline points="17 18 12 13 7 18"/> */
export const CHEVRONS_UP =
  "M 17 11 L 12 6 L 7 11 M 17 18 L 12 13 L 7 18";

/** Sun icon (theme toggle: light mode). 9 subpaths — center circle (r=4 at 12,12,
 *  rendered as two semicircular arcs) plus 8 ray segments (cardinal + diagonals).
 *  Source (lucide `sun`):
 *    <circle cx="12" cy="12" r="4"/>
 *    <line x1="12" y1="2" x2="12" y2="5"/>
 *    <line x1="12" y1="19" x2="12" y2="22"/>
 *    <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/>
 *    <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
 *    <line x1="2" y1="12" x2="5" y2="12"/>
 *    <line x1="19" y1="12" x2="22" y2="12"/>
 *    <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/>
 *    <line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
 *  The many-subpath shape morphs cleanly to MOON (1 subpath) via morphicons'
 *  per-subpath Procrustes + subpath duplication — the rays collapse into the
 *  crescent's silhouette in flight. */
export const SUN =
  "M 8 12 A 4 4 0 1 0 16 12 A 4 4 0 1 0 8 12 Z " +
  "M 12 2 V 5 " +
  "M 12 19 V 22 " +
  "M 4.22 4.22 L 6.34 6.34 " +
  "M 17.66 17.66 L 19.78 19.78 " +
  "M 2 12 H 5 " +
  "M 19 12 H 22 " +
  "M 4.22 19.78 L 6.34 17.66 " +
  "M 17.66 6.34 L 19.78 4.22";

/** Moon icon (theme toggle: dark mode). Single closed subpath — the standard
 *  lucide crescent carved from a 9-radius disk and a 7-radius disk. Source
 *  (lucide `moon`):
 *    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
 *  Companion to SUN for the sidebar theme toggle; the morph between the two
 *  reads as "the sun setting into a moon". */
export const MOON =
  "M 21 12.79 A 9 9 0 1 1 11.21 3 A 7 7 0 0 0 21 12.79 Z";