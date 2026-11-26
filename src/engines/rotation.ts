/**
 * Rotated content regions. A region turns about its centre, positive clockwise on screen (y grows downwards), so its
 * corners are real numbers; pixels stay integers everywhere else. Pure.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Corners = readonly [Point, Point, Point, Point];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Degrees in (-180, 180], so 360 and 0 are the same turn and compare equal. */
export function normalizeDegrees(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
}

export function radians(deg: number): number {
  return (normalizeDegrees(deg) * Math.PI) / 180;
}

/**
 * Corners of `box` turned by `deg` about `centre` (the box's own centre by default): top-left, top-right, bottom-right,
 * bottom-left of the unturned box. With 0 degrees they are the box's corners exactly.
 */
export function rotatedCorners(box: Box, deg: number, centre: Point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }): Corners {
  const pts: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  if (normalizeDegrees(deg) === 0) return pts as unknown as Corners;
  const t = radians(deg);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return pts.map((p) => {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    return { x: centre.x + dx * c - dy * s, y: centre.y + dx * s + dy * c };
  }) as unknown as Corners;
}

/** Whole-pixel box that holds the corners: floor of the minimum, ceiling of the maximum. */
export function cornersBounds(corners: readonly Point[]): { x: number; y: number; width: number; height: number } {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  // Corners are computed in floating point; snap values within a millionth of a pixel to it before rounding outwards.
  const snap = (v: number) => (Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : v);
  const x0 = Math.floor(snap(Math.min(...xs)));
  const y0 = Math.floor(snap(Math.min(...ys)));
  const x1 = Math.ceil(snap(Math.max(...xs)));
  const y1 = Math.ceil(snap(Math.max(...ys)));
  // `+ 0` turns a -0 from rounding a tiny negative into 0.
  return { x: x0 + 0, y: y0 + 0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Whether two convex polygons share area (separating axis test). Touching edges don't count as overlap, so screens
 * placed edge to edge stay valid.
 */
export function polygonsOverlap(a: readonly Point[], b: readonly Point[]): boolean {
  const EPS = 1e-6;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q.y - p.y;
      const ny = p.x - q.x;
      const len = Math.hypot(nx, ny);
      if (len === 0) continue;
      const project = (pts: readonly Point[]) => pts.map((r) => (r.x * nx + r.y * ny) / len);
      const pa = project(a);
      const pb = project(b);
      if (Math.max(...pa) <= Math.min(...pb) + EPS || Math.max(...pb) <= Math.min(...pa) + EPS) return false;
    }
  }
  return true;
}
