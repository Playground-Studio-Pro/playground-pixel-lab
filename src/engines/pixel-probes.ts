import type { VideoTarget } from "./video-targets";
import { GRID, gridPixelAt, pixelGridOps, type GridOp, type GridRegion, type Rgb } from "./pixel-grid";

/**
 * Probe pixels for the Electron pixel tests (PHYSICAL_OUTPUT 8.8, task O5): device pixels of the output window and
 * the exact RGB the pixel grid must put there. Pure, deterministic for a seed. Text boxes are skipped: their glyphs
 * are anti-aliased, so only the box around them is exact.
 *
 * - Display space: the grid drawn over the whole framebuffer from device pixel (0, 0).
 * - Master space: one output of a mapping. Each output pixel inside a slice reads the master grid at
 *   `from + (pixel − to)`; every other output pixel is black, as `targetSource` draws it.
 */

export interface Probe {
  readonly x: number;
  readonly y: number;
  readonly rgb: Rgb;
}

/** A small seeded generator (mulberry32), so random probes are the same every run. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The probe positions inside one w × h grid rectangle, in its own coordinates. */
function rectPoints(w: number, h: number, ops: readonly GridOp[], next: () => number, randomCount: number): [number, number][] {
  const pts: [number, number][] = [];
  const add = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) pts.push([x, y]);
  };
  // Corners and edges at offsets 0–3 from every edge, at the ends and three points along each.
  for (const d of [0, 1, 2, 3]) {
    for (const f of [0, 0.25, 0.5, 0.75]) {
      const x = Math.floor((w - 1) * f);
      const y = Math.floor((h - 1) * f);
      add(x, d), add(x, h - 1 - d), add(d, y), add(w - 1 - d, y);
    }
    for (const e of [0, 1, 2, 3]) add(d, e), add(w - 1 - d, e), add(d, h - 1 - e), add(w - 1 - d, h - 1 - e);
  }
  // Corner markers, every pixel.
  const I = GRID.markerInset;
  const M = GRID.markerSize;
  for (const [ox, oy] of [[I, I], [w - I - M, I], [I, h - I - M], [w - I - M, h - I - M]]) {
    for (let v = 0; v < M; v++) for (let u = 0; u < M; u++) add(ox + u, oy + v);
  }
  // Every checker and stripe patch, at full density.
  for (const op of ops) if (op.kind === "pattern") for (let v = 0; v < op.h; v++) for (let u = 0; u < op.w; u++) add(op.x + u, op.y + v);
  // Random points with a fixed seed.
  for (let i = 0; i < randomCount; i++) add(Math.floor(next() * w), Math.floor(next() * h));
  return pts;
}

function dedupe(probes: Probe[]): Probe[] {
  const seen = new Set<number>();
  return probes.filter((p) => {
    const k = p.y * 1_000_003 + p.x;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Display space: the grid over a `width` × `height` framebuffer, labelled as the output page labels it. */
export function displayProbes(width: number, height: number, seed = 1): Probe[] {
  const label = { originX: 0, originY: 0, title: `Display · ${width} × ${height} px` };
  const ops = pixelGridOps({ w: width, h: height }, label, { motionFrame: null });
  const next = random(seed);
  const out: Probe[] = [];
  for (const [x, y] of rectPoints(width, height, ops, next, 2000)) {
    const rgb = gridPixelAt(ops, x, y);
    if (rgb !== "text") out.push({ x, y, rgb });
  }
  return dedupe(out);
}

/** Master space: one output target (from `videoTargets`) and the master grid regions (`masterGridRegions`). */
export function masterProbes(target: VideoTarget, regions: readonly GridRegion[], seed = 1): Probe[] {
  if (!target.regions) throw new Error("A master-space probe set needs an output or screen target.");
  const ops = regions.map((r) => pixelGridOps(r.size, r.label, { motionFrame: null }));
  const next = random(seed);
  /** What the output shows at (x, y): the last slice covering it, read from the last master region covering that. */
  const expected = (x: number, y: number): Rgb | "text" => {
    let slice = null;
    for (const r of target.regions!) if (x >= r.to.x && y >= r.to.y && x < r.to.x + r.from.width && y < r.to.y + r.from.height) slice = r;
    if (!slice) return [0, 0, 0];
    const mx = slice.from.x + (x - slice.to.x);
    const my = slice.from.y + (y - slice.to.y);
    for (let i = regions.length - 1; i >= 0; i--) {
      const g = regions[i];
      if (mx >= g.x && my >= g.y && mx < g.x + g.size.w && my < g.y + g.size.h) return gridPixelAt(ops[i], mx - g.x, my - g.y);
    }
    return [0, 0, 0];
  };
  const pts: [number, number][] = [];
  for (const r of target.regions) {
    // Each slice's grid, in output coordinates: corners, edges, markers, patches, random points.
    const g = regions.find((q) => q.x === r.from.x && q.y === r.from.y && q.size.w === r.from.width && q.size.h === r.from.height);
    const local = g ? ops[regions.indexOf(g)] : [];
    for (const [u, v] of rectPoints(r.from.width, r.from.height, local, next, 300)) pts.push([r.to.x + u, r.to.y + v]);
    // Just outside each slice: black unless another slice is there.
    for (const [u, v] of [[-1, 0], [0, -1], [r.from.width, 0], [0, r.from.height], [r.from.width, r.from.height - 1], [r.from.width - 1, r.from.height]]) pts.push([r.to.x + u, r.to.y + v]);
  }
  for (let i = 0; i < 500; i++) pts.push([Math.floor(next() * target.width), Math.floor(next() * target.height)]);
  const out: Probe[] = [];
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= target.width || y >= target.height) continue;
    const rgb = expected(x, y);
    if (rgb !== "text") out.push({ x, y, rgb });
  }
  return dedupe(out);
}
