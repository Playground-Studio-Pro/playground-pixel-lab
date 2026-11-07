import type { Rect } from "@/domain/units";

type R = Rect<number>;

export function right(r: R): number {
  return r.x + r.width;
}

export function bottom(r: R): number {
  return r.y + r.height;
}

/** True when two rectangles share at least one pixel. Touching edges do not overlap. */
export function overlaps(a: R, b: R): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

export function intersection(a: R, b: R): R | null {
  if (!overlaps(a, b)) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.min(right(a), right(b)) - x, height: Math.min(bottom(a), bottom(b)) - y };
}

/** Tight bounding box. Null for an empty list. */
export function boundingBox(rects: readonly R[]): R | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rects.map(right)) - x,
    height: Math.max(...rects.map(bottom)) - y,
  };
}

/** True when inner lies entirely inside a width×height area anchored at the origin. */
export function fitsInside(inner: R, width: number, height: number): boolean {
  return inner.x >= 0 && inner.y >= 0 && right(inner) <= width && bottom(inner) <= height;
}
