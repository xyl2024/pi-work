export const DEFAULT_CANVAS_SCALE = 0.85;
export const MIN_CANVAS_SCALE = 0.3;
export const MAX_CANVAS_SCALE = 2;

export function clampCanvasScale(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_CANVAS_SCALE;
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, value));
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface ZoomAnchor {
  contentX: number;
  contentY: number;
  mx: number;
  my: number;
}

export interface ComputeZoomAnchorArgs {
  currentScale: number;
  scroll: { left: number; top: number };
  viewport: { width: number; height: number };
  pointer?: CanvasPoint;
  pending?: ZoomAnchor | null;
}

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

export function scrollForAnchor(
  anchor: ZoomAnchor,
  scale: number,
): { left: number; top: number } {
  return {
    left: Math.max(0, anchor.contentX * scale - anchor.mx),
    top: Math.max(0, anchor.contentY * scale - anchor.my),
  };
}

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
