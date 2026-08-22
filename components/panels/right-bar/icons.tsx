// Static (hook-less) SVG icons for the right-bar button column. Each const is
// a zero-arg component so it can be inlined via <PanelToggleIcon /> rather
// than reallocated per render. We deliberately use the `: () => ReactElement`
// form rather than `ReactNode` constants — ReactNode isn't callable, so the
// React JSX runtime would refuse `<PanelToggleIcon />`.
//
// Animated icons (ExpandRightIcon, PencilIcon, TranslateIcon, …) live in the
// common layer at `@/components/ui/animated-icons` — one file each. Keep them
// out of this module because they carry hooks and must be rendered as JSX
// elements, not called as plain functions.
//
// All glyphs share the same 16×16 box and currentColor stroke so they sit
// cleanly in the 36×36 column. Mapped to descriptors in `./desc`.

import type { ReactElement } from "react";

const PROPS_16 = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const PanelToggleIcon = (): ReactElement => (
  <svg {...PROPS_16}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </svg>
);

// Collapse affordance (down/left chevrons) — plain glyph drilled from the
// expand button. Faces 'out' (collapse); the animated ExpandRightIcon faces
// 'in' (expand).
export const ExpandLeftIcon = (): ReactElement => (
  <svg {...PROPS_16}>
    <polyline points="13 7 18 12 13 17" />
    <polyline points="6 7 11 12 6 17" />
  </svg>
);

export const TodoCheckIcon = (): ReactElement => (
  <svg {...PROPS_16}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <polyline points="8 12 11 15 17 9" />
  </svg>
);

// The RSS glyph uses a 16×16 viewBox so the dot+arc fits the same weight
// as the rest of the column. Filled dot for the source, two arcs for tiers.
export const RssIcon = (): ReactElement => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="3.5" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M2 8a6 6 0 0 1 6 6" />
    <path d="M2 4a10 10 0 0 1 10 10" />
  </svg>
);

// LLM API audit: code brackets `</>` — single metaphor for HTTP API / devtools,
// matches the JSON request/response bodies the panel expands to.
export const LlmAuditIcon = (): ReactElement => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 4 2 8 6 12" />
    <polyline points="10 4 14 8 10 12" />
    <line x1="9" y1="3" x2="7" y2="13" />
  </svg>
);

// Star with selectable fill. Active state uses fill="var(--accent)" instead
// of just the color flip — the descriptor passes the active fill value when
// building the icon (favorites is the only descriptor that drives SVG fill
// from active state today).
export const StarIconWithFill = (fill: "none" | "currentColor" | "var(--accent)"): ReactElement => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);