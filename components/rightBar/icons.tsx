// SVG icons for the right-bar button column. Each const is a zero-arg
// component so it can be inlined via <PencilIcon /> rather than reallocated
// per render. We deliberately use the `: () => ReactElement` form rather
// than `ReactNode` constants — ReactNode isn't callable, so the React JSX
// runtime would refuse `<WrenchIcon />`. All glyphs share the same 16×16 box
// and currentColor stroke so they sit cleanly in the 36×36 column.

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

export const ExpandLeftIcon = (): ReactElement => (
  <svg {...PROPS_16}>
    <polyline points="13 7 18 12 13 17" />
    <polyline points="6 7 11 12 6 17" />
  </svg>
);

export const ExpandRightIcon = (): ReactElement => (
  <svg {...PROPS_16}>
    <polyline points="11 17 6 12 11 7" />
    <polyline points="18 17 13 12 18 7" />
  </svg>
);

export const TodoCheckIcon = (): ReactElement => (
  <svg {...PROPS_16}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <polyline points="8 12 11 15 17 9" />
  </svg>
);

// Document icon for the Context panel: represents the assembled system prompt
// without borrowing a coloured file-type icon from the file explorer.
export const ContextDocumentIcon = (): ReactElement => (
  <svg {...PROPS_16} strokeWidth={1.8}>
    <path d="M6 3h7l5 5v13H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M13 3v5h5" />
    <path d="M8 12h8M8 16h8" />
  </svg>
);

export const PencilIcon = (): ReactElement => (
  <svg {...PROPS_16} strokeWidth={1.8}>
    <path d="M18.37 2.63a1.75 1.75 0 0 1 2.48 2.48L9 16.96l-4.5 1.04 1.04-4.5Z" />
    <path d="M14 7l3 3" />
  </svg>
);

export const TranslateIcon = (): ReactElement => (
  <svg {...PROPS_16} strokeWidth={1.8}>
    <path d="M3 5h12" />
    <path d="M9 3v2" />
    <path d="M5 5c0 4 3 7 6 9" />
    <path d="M11 5c0 3-2 6-6 8" />
    <path d="M14 21l5-12 5 12" />
    <path d="M15.5 17h7" />
  </svg>
);

export const JsonBracesIcon = (): ReactElement => (
  <svg {...PROPS_16}>
    <path d="M8 3 H6 a2 2 0 0 0 -2 2 v3 a2 2 0 0 1 -2 2 a2 2 0 0 1 2 2 v3 a2 2 0 0 0 2 2 h2" />
    <path d="M16 3 h2 a2 2 0 0 1 2 2 v3 a2 2 0 0 0 2 2 a2 2 0 0 0 -2 2 v3 a2 2 0 0 1 -2 2 h-2" />
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

export const GitDiffIcon = (): ReactElement => (
  <svg {...PROPS_16}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="6" r="3" />
    <path d="M6 9v6" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

// Parent bubble + branching stem + two child bubbles.
export const ConversationTreeIcon = (): ReactElement => (
  <svg {...PROPS_16} strokeWidth={1.8}>
    <rect x="8" y="2" width="8" height="6" rx="2.5" />
    <path d="M10.5 8 L12 10.5 L13.5 8" />
    <path d="M12 10.5 L12 12" />
    <path d="M6.5 12 L17.5 12" />
    <path d="M6.5 12 L6.5 13.5" />
    <path d="M17.5 12 L17.5 13.5" />
    <path d="M5.2 15 L6.5 13.5 L7.8 15" />
    <path d="M16.2 15 L17.5 13.5 L18.8 15" />
    <rect x="3" y="15" width="7" height="5.5" rx="2" />
    <rect x="14" y="15" width="7" height="5.5" rx="2" />
  </svg>
);

// Three ascending bars + baseline. 16×16 viewBox matches the other
// bars-shaped icons in the column.
export const TokensIcon = (): ReactElement => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" y1="14" x2="2" y2="9" />
    <line x1="7" y1="14" x2="7" y2="5" />
    <line x1="12" y1="14" x2="12" y2="2" />
    <line x1="0.5" y1="14.5" x2="15.5" y2="14.5" />
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

// Tool calls: wrench icon. The running/total counter sits next to this in
// RightBarButton with bodyLayout: column + gap.
export const WrenchIcon = (): ReactElement => (
  <svg {...PROPS_16}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

export const TerminalIcon = (): ReactElement => (
  <svg {...PROPS_16}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
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

