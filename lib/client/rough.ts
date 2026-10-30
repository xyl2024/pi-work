export type RoughPoint = [number, number];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function sketchRotateDeg(id: string, maxDeg = 1.6): number {
  const h = hashString(id);
  return ((h % 1000) / 1000) * 2 * maxDeg - maxDeg;
}

function smoothPath(pts: RoughPoint[]): string {
  if (pts.length < 3) {
    return pts
      .map((p, i) =>
        i === 0
          ? `M ${p[0].toFixed(1)} ${p[1].toFixed(1)}`
          : `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`,
      )
      .join(" ");
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function roughLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  amplitude = 1.6,
): string {
  return roughPolyline([[x1, y1], [x2, y2]], seed, amplitude);
}

export function roughPolyline(
  points: RoughPoint[],
  seed: number,
  amplitude = 1.6,
): string {
  const rnd = mulberry32(seed);
  const pts: RoughPoint[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const segments = Math.max(2, Math.round(len / 22));
    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      const off = (rnd() * 2 - 1) * amplitude;
      pts.push([px + nx * off, py + ny * off]);
    }
    pts.push([x2, y2]);
  }
  return smoothPath(pts);
}

export function roughRect(
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  amplitude = 1.1,
): string[] {
  const rnd = mulberry32(seed);
  const out: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const edges: [number, number, number, number][] = [
      [x, y, x + w, y],
      [x + w, y, x + w, y + h],
      [x + w, y + h, x, y + h],
      [x, y + h, x, y],
    ];
    for (const [x1, y1, x2, y2] of edges) {
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      const sInset = rnd() * 1.6;
      const eInset = rnd() * 1.6;
      let sx = x1 + ux * sInset;
      let sy = y1 + uy * sInset;
      let ex = x2 - ux * eInset;
      let ey = y2 - uy * eInset;
      if (pass === 1) {
        const off = 0.4 + rnd() * 0.8;
        const side = rnd() > 0.5 ? 1 : -1;
        sx += -uy * off * side;
        sy += ux * off * side;
        ex += -uy * off * side;
        ey += ux * off * side;
      }
      out.push(roughLine(sx, sy, ex, ey, rnd() * 4294967295, amplitude));
    }
  }
  return out;
}
