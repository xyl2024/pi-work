// ============================================================================
// Sidebar section geometry (pure)
//
// The left sidebar's "Today's Sessions" section is capped by how many *rows*
// it shows rather than by a share of the viewport, and it is the first section
// to give up height when the column runs short. The numbers behind that — the
// row height, the list's vertical padding, the cap and the floor in rows — and
// the scroll-edge/fade decision that hints at hidden content are worth pinning
// down without a browser, so they live here.
//
// The DOM side — measuring the scroll container, the `scroll` listener, the
// `ResizeObserver`, writing the mask — stays in
// `components/ui/SidebarSection.tsx`. Like `sidebar-paging` and `scroll-follow`
// (ADR-0002/0003) this module may not import React, the DOM, a client hook, or
// anything from `lib/server`. `ScrollMetrics` and `distanceFromBottom()` are
// reused from `scroll-follow` rather than re-inventing a second metric type.
//
// `TODAY_VISIBLE_ROWS` is deliberately NOT `SESSION_PAGE_SIZE_GROUPED`: that
// one is how many rows a page request asks the API for, while this one is how
// many rows fit on screen. This one is 4 while the page size stays 6; tying
// "change the page size" to "change the sidebar height" would make each change
// trip over the other.
// ============================================================================

import { distanceFromBottom, type ScrollMetrics } from "./scroll-follow";

/** Fixed height of one session row (`SessionItem`). */
export const SESSION_ROW_HEIGHT_PX = 28;

/** The list container's vertical padding (4px top + 8px bottom). */
export const SIDEBAR_LIST_PADDING_Y_PX = 12;

/** Rows the "Today's Sessions" list shows before it scrolls. */
export const TODAY_VISIBLE_ROWS = 4;

/** Rows the section keeps when the sidebar compresses it. */
export const TODAY_MIN_ROWS = 1;

/** Sub-pixel slack for "the scroll is still at an edge". */
export const SCROLL_EDGE_THRESHOLD_PX = 1;

/** How wide the top/bottom scroll hint fades are. */
export const SCROLL_FADE_PX = 16;

/** The height of a list showing `rows` rows, padding included. */
export function sidebarListHeightPx(rows: number): number {
  return rows * SESSION_ROW_HEIGHT_PX + SIDEBAR_LIST_PADDING_Y_PX;
}

/** Which sides of the scrollport are hiding content. */
export interface ScrollEdges {
  top: boolean;
  bottom: boolean;
}

/** Nothing hidden on either side. */
export const NO_SCROLL_EDGES: ScrollEdges = { top: false, bottom: false };

/**
 * Which sides of the scroll container hide content, from the container's
 * layout. `metrics` is null before the container is mounted; content that does
 * not overflow hides nothing; a scroll within `SCROLL_EDGE_THRESHOLD_PX` of an
 * edge still counts as being at that edge, so a sub-pixel scroll does not blink
 * the hint on.
 */
export function decideScrollEdges(metrics: ScrollMetrics | null): ScrollEdges {
  if (!metrics) return NO_SCROLL_EDGES;
  if (metrics.scrollHeight <= metrics.clientHeight) return NO_SCROLL_EDGES;
  return {
    top: metrics.scrollTop > SCROLL_EDGE_THRESHOLD_PX,
    bottom: distanceFromBottom(metrics) > SCROLL_EDGE_THRESHOLD_PX,
  };
}

/**
 * The `mask-image` that fades the sides with hidden content, or undefined when
 * neither side needs a hint — no mask is better than an identity mask, which
 * would only add a compositing layer.
 */
export function scrollFadeMaskImage(
  edges: ScrollEdges,
  fadePx: number = SCROLL_FADE_PX,
): string | undefined {
  if (!edges.top && !edges.bottom) return undefined;
  if (edges.top && edges.bottom) {
    return `linear-gradient(to bottom, transparent 0, black ${fadePx}px, black calc(100% - ${fadePx}px), transparent 100%)`;
  }
  if (edges.top) return `linear-gradient(to bottom, transparent 0, black ${fadePx}px)`;
  return `linear-gradient(to bottom, black calc(100% - ${fadePx}px), transparent 100%)`;
}
