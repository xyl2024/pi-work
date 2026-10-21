/**
 * Zoom math for a pan/zoom canvas (currently the conversation tree).
 *
 * The canvas is one unscaled coordinate space that is rendered through
 * `transform: scale(s)` with `transform-origin: top left` inside a
 * scrollable viewport. Zooming must keep the point under the cursor (or
 * the viewport center) pinned: we therefore remember that point in
 * *unscaled* canvas coordinates plus its offset inside the viewport, and
 * rewrite scrollLeft/scrollTop once the browser knows the new layout.
 *
 * Pure and DOM-free so the tricky part (anchoring across a burst of wheel
 * events, before React has committed the new scroll) is unit-tested.
 */

export const DEFAULT_CANVAS_SCALE = 0.85;
export const MIN_CANVAS_SCALE = 0.3;
export const MAX_CANVAS_SCALE = 2;

/** Clamp a zoom factor into [MIN_CANVAS_SCALE, MAX_CANVAS_SCALE]. */
export function clampCanvasScale(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_CANVAS_SCALE;
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, value));
}

export interface CanvasPoint {
  x: number;
  y: number;
}

/** A point on the canvas, plus where it should stay inside the viewport. */
export interface ZoomAnchor {
  /** Unscaled canvas coordinate (padding included). */
  contentX: number;
  contentY: number;
  /** Viewport-relative offset that must keep showing that canvas point. */
  mx: number;
  my: number;
}

export interface ComputeZoomAnchorArgs {
  /** Scale currently in effect (before this zoom step). */
  currentScale: number;
  scroll: { left: number; top: number };
  viewport: { width: number; height: number };
  /** Pointer position in viewport coordinates; omitted → viewport center. */
  pointer?: CanvasPoint;
  /**
   * Anchor computed by a previous zoom step whose scroll has not been
   * written yet. Wheel events can fire several times before the render
   * commits, so `scroll` is stale; deriving from the pending anchor keeps
   * the point under the cursor pinned instead of drifting.
   */
  pending?: ZoomAnchor | null;
}

/**
 * Where the canvas point under `pointer` lives, in unscaled coordinates.
 */
export function computeZoomAnchor({
  currentScale,
  scroll,
  viewport,
  pointer,
  pending,
}: ComputeZoomAnchorArgs): ZoomAnchor {
  const scale = currentScale > 0 ? currentScale : 1;
  const mx = pointer ? pointer.x : viewport.width / 2;
  const my = pointer ? pointer.y : viewport.height / 2;
  if (pending) {
    return {
      contentX: pending.contentX + (mx - pending.mx) / scale,
      contentY: pending.contentY + (my - pending.my) / scale,
      mx,
      my,
    };
  }
  return {
    contentX: (scroll.left + mx) / scale,
    contentY: (scroll.top + my) / scale,
    mx,
    my,
  };
}

/**
 * Scroll offsets that put `anchor` back under its viewport offset at the
 * given scale. Negative values are impossible to scroll to, so clamp to 0.
 */
export function scrollForAnchor(
  anchor: ZoomAnchor,
  scale: number,
): { left: number; top: number } {
  return {
    left: Math.max(0, anchor.contentX * scale - anchor.mx),
    top: Math.max(0, anchor.contentY * scale - anchor.my),
  };
}

/**
 * Scale that fits an unscaled canvas into the viewport, leaving `inset`
 * pixels of breathing room on every side.
 */
export function fitCanvasScale(
  canvas: { width: number; height: number },
  viewport: { width: number; height: number },
  inset = 12,
): number {
  if (canvas.width <= 0 || canvas.height <= 0) return DEFAULT_CANVAS_SCALE;
  return clampCanvasScale(
    Math.min(
      (viewport.width - inset * 2) / canvas.width,
      (viewport.height - inset * 2) / canvas.height,
    ),
  );
}
