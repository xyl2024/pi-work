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

/** Download-to-tray icon (idle export).
 *  Source:
 *    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
 *    <polyline points="7 10 12 15 17 10"/>
 *    <line x1="12" y1="15" x2="12" y2="3"/> */
export const DOWNLOAD =
  "M 21 15 V 19 A 2 2 0 0 1 19 21 H 5 A 2 2 0 0 1 3 19 V 15 M 7 10 L 12 15 L 17 10 M 12 15 V 3";

/** Loader / spinner: six short radial strokes (12, 3, 6, 9 o'clock + the two diagonals).
 *  Source: 6 × <line ...> at angles 0/45/90/135/180/225 deg, inner radius 2,
 *  outer radius 6. */
export const LOADER =
  "M 12 2 V 6 M 12 18 V 22 M 4.93 4.93 L 7.76 7.76 M 16.24 16.24 L 19.07 19.07 M 2 12 H 6 M 18 12 H 22";

/** Sparkle / star (idle auto-name) — a 4-point sparkle with a smaller satellite.
 *  Source:
 *    <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2z"/>
 *    <path d="M19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9L19 14z"/> */
export const SPARKLE =
  "M 12 2 L 13.8 7.4 L 19 9 L 13.8 10.6 L 12 16 L 10.2 10.6 L 5 9 L 10.2 7.4 Z M 19 14 L 19.9 16.6 L 22 17.5 L 19.9 18.4 L 19 21 L 18.1 18.4 L 16 17.5 L 18.1 16.6 Z";

/** Clock icon (auto-name in progress).
 *  Source: <circle cx="12" cy="12" r="9"/> + <path d="M12 7v5l3 2"/>
 *  Circle as two arcs joined with Z. */
export const CLOCK =
  "M 3 12 A 9 9 0 1 0 21 12 A 9 9 0 1 0 3 12 Z M 12 7 V 12 L 15 14";

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

/** Empty checkbox outline on the 10×10 grid. Companion to CHECKBOX_CHECKED
 *  for the TodoPanel row. Source: <rect x="1.5" y="1.5" width="8" height="8"/> */
export const EMPTY_CHECKBOX = "M 1.5 1.5 H 9.5 V 9.5 H 1.5 Z";

/** Checked checkbox: outline + checkmark, both on the 10×10 grid. Source:
 *    <rect x="1.5" y="1.5" width="8" height="8"/>
 *    <polyline points="2 5 4.5 7.5 8.5 2.5"/> */
export const CHECKBOX_CHECKED = "M 1.5 1.5 H 9.5 V 9.5 H 1.5 Z M 2 5 L 4.5 7.5 L 8.5 2.5";

/** "Copy minify" icon: two diagonal arrows compressing. Source (4 subpaths):
 *    <polyline points="4 14 10 14 10 20"/>
 *    <polyline points="20 10 14 10 14 4"/>
 *    <line x1="14" y1="10" x2="21" y2="3"/>
 *    <line x1="3" y1="21" x2="10" y2="14"/> */
export const MINIFY =
  "M 4 14 L 10 14 L 10 20 M 20 10 L 14 10 L 14 4 M 14 10 L 21 3 M 3 21 L 10 14";

/** "Copy minify & escape" icon: a document corner with a folded tab.
 *  Source (2 subpaths):
 *    <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
 *    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/> */
export const ESCAPE_DOC =
  "M 14 3 V 7 A 1 1 0 0 0 15 8 H 19 M 17 21 H 7 A 2 2 0 0 1 5 19 V 5 A 2 2 0 0 1 7 3 H 14 L 19 8 V 19 A 2 2 0 0 1 17 21 Z";

/** Thumbs-up icon (idle like button). Two subpaths: the hand/palm outline
 *  and the thumb shaft. Source (lucide `thumbs-up`):
 *    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>
 *    <path d="M7 10v12"/> */
export const THUMBS_UP =
  "M 15 5.88 L 14 10 H 19.83 A 2 2 0 0 1 21.75 12.56 L 19.42 20.56 A 2 2 0 0 1 17.5 22 H 4 A 2 2 0 0 1 2 20 V 12 A 2 2 0 0 1 4 10 H 6.76 A 2 2 0 0 0 8.55 8.89 L 12 2 A 3.13 3.13 0 0 1 15 5.88 Z M 7 10 V 22";

/** Heart icon (liked state). Single subpath. Source (lucide `heart`):
 *    <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/> */
export const HEART =
  "M 2 9.5 A 5.5 5.5 0 0 1 11.591 5.824 A 0.56 0.56 0 0 0 12.409 5.824 A 5.49 5.49 0 0 1 22 9.5 C 22 11.79 20.5 13.5 19 15 L 13.508 20.313 A 2 2 0 0 1 10.508 20.332 L 5 15 C 3.5 13.5 2 11.8 2 9.5";