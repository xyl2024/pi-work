export interface EdgeScrollOptions {
  edgeZone?: number;
  maxSpeed?: number;
}

export interface EdgeRect {
  left: number;
  right: number;
}

export function computeEdgeScrollVelocity(
  clientX: number,
  rect: EdgeRect,
  options: EdgeScrollOptions = {},
): number {
  const edgeZone = options.edgeZone ?? 40;
  const maxSpeed = options.maxSpeed ?? 14;
  const tLeft = (clientX - rect.left) / edgeZone;
  const tRight = (rect.right - clientX) / edgeZone;
  const t = Math.min(tLeft, tRight);
  if (t < 0 || t > 1) return 0;
  const speed = maxSpeed * (1 - t);
  return tLeft <= tRight ? -speed : speed;
}

export type EdgeAutoscrollTarget = HTMLElement;

export function createEdgeAutoscroll(options: EdgeScrollOptions = {}) {
  let frame: number | null = null;
  let clientX: number | null = null;
  let target: EdgeAutoscrollTarget | null = null;

  const step = () => {
    if (!target) {
      frame = null;
      return;
    }
    if (clientX !== null) {
      const velocity = computeEdgeScrollVelocity(clientX, target.getBoundingClientRect(), options);
      if (velocity !== 0 && target.scrollWidth > target.clientWidth) {
        target.scrollLeft += velocity;
      }
    }
    frame = requestAnimationFrame(step);
  };

  return {
    update(x: number) {
      clientX = x;
    },
    start(element: EdgeAutoscrollTarget) {
      target = element;
      if (frame === null) frame = requestAnimationFrame(step);
    },
    stop() {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      clientX = null;
      target = null;
    },
  };
}
