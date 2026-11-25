import { overlaps } from "../geometry";

/**
 * Packs rectangles 1:1 into outputs. Never scales, never rotates, never overlaps, never leaves an output.
 * Deterministic: the same items and bins always give the same placements. Pure.
 */

export interface PackItem {
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

export interface PackBin {
  readonly width: number;
  readonly height: number;
  /** Space already taken in this output, in output pixels. */
  readonly obstacles: readonly { x: number; y: number; width: number; height: number }[];
}

export interface Placement {
  readonly bin: number;
  readonly x: number;
  readonly y: number;
}

export interface PackResult {
  readonly placements: ReadonlyMap<string, Placement>;
  /** Items that found no room, in input order. */
  readonly unplaced: readonly string[];
  /** Bins with at least one new item. */
  readonly binsUsed: number;
}

type R = { x: number; y: number; width: number; height: number };

/** Orders tried, best first. Ties keep input order, so results are stable. */
const ORDERS: ((a: PackItem, b: PackItem) => number)[] = [
  (a, b) => b.height - a.height || b.width - a.width,
  (a, b) => b.width - a.width || b.height - a.height,
  (a, b) => b.width * b.height - a.width * a.height,
  (a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height),
];

function packInOrder(items: readonly PackItem[], bins: readonly PackBin[]): PackResult {
  const taken: R[][] = bins.map((b) => [...b.obstacles]);
  const used = new Set<number>();
  const placements = new Map<string, Placement>();
  const unplaced: string[] = [];
  for (const item of items) {
    let placed: Placement | null = null;
    for (let bin = 0; bin < bins.length && !placed; bin++) {
      const { width, height } = bins[bin];
      if (item.width > width || item.height > height) continue;
      const rects = taken[bin];
      const points: [number, number][] = [[0, 0]];
      for (const r of rects) points.push([r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, 0], [0, r.y + r.height]);
      points.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      for (const [x, y] of points) {
        if (x + item.width > width || y + item.height > height) continue;
        const candidate = { x, y, width: item.width, height: item.height };
        if (rects.some((r) => overlaps(r, candidate))) continue;
        rects.push(candidate);
        used.add(bin);
        placed = { bin, x, y };
        break;
      }
    }
    if (placed) placements.set(item.key, placed);
    else unplaced.push(item.key);
  }
  return { placements, unplaced, binsUsed: used.size };
}

/** Tries a few orders and keeps the one that places the most items in the fewest outputs. */
export function packRects(items: readonly PackItem[], bins: readonly PackBin[]): PackResult {
  let best: PackResult | null = null;
  for (const order of ORDERS) {
    const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => order(a.it, b.it) || a.i - b.i).map((x) => x.it);
    const result = packInOrder(sorted, bins);
    const restored = { ...result, unplaced: items.filter((it) => result.unplaced.includes(it.key)).map((it) => it.key) };
    if (!best || restored.unplaced.length < best.unplaced.length || (restored.unplaced.length === best.unplaced.length && restored.binsUsed < best.binsUsed)) best = restored;
  }
  return best ?? { placements: new Map(), unplaced: [], binsUsed: 0 };
}

/** How many empty outputs of one size the items need, or null when an item is larger than the output. */
export function outputsNeeded(items: readonly PackItem[], size: { width: number; height: number }, max = 64): number | null {
  if (items.some((it) => it.width > size.width || it.height > size.height)) return null;
  const bins = Array.from({ length: Math.min(max, Math.max(1, items.length)) }, () => ({ ...size, obstacles: [] }));
  const result = packRects(items, bins);
  return result.unplaced.length ? null : result.binsUsed;
}
