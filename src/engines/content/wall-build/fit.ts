import { WALK_CYCLE, workerShapes, type WorkerInput, type WorkerShape } from "./character";

/**
 * The size of a worker that stays whole on a low wall, in every pose it uses there. Pure: it measures the
 * shapes themselves, so the answer is exact at any size.
 */

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The box around shapes, in their own pixels. Curves are bounded by their control points. */
export function shapesBounds(shapes: readonly WorkerShape[]): Bounds {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    left = Math.min(left, x0);
    top = Math.min(top, y0);
    right = Math.max(right, x1);
    bottom = Math.max(bottom, y1);
  };
  for (const s of shapes) {
    if (s.kind === "rect") add(s.x, s.y, s.x + s.w, s.y + s.h);
    else if (s.kind === "disc") add(s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r);
    else {
      const half = s.kind === "line" ? Math.ceil(s.width / 2) : 0;
      const points = s.kind === "curve" ? [s.from, ...s.curves.flat()] : s.points;
      for (const [x, y] of points) add(x - half, y - half, x + half, y + half);
    }
  }
  return { left, top, right, bottom };
}

/** How far a worker reaches from the point between its feet, on either side, above and below. */
export interface WorkerFit {
  readonly height: number;
  readonly side: number;
  readonly above: number;
  readonly below: number;
}

interface LowWall {
  readonly width: number;
  readonly height: number;
  readonly rows: number;
  readonly cabinet: { readonly width: number; readonly height: number };
}

/** Where the feet go for each row: on the row's level, or as near to it as keeps the worker in the wall. */
export function lowFeet(wall: Pick<LowWall, "height">, rowBottom: number, fit: Pick<WorkerFit, "above" | "below">): number {
  return Math.min(wall.height - fit.below, Math.max(fit.above, rowBottom));
}

function measure(wall: LowWall, height: number): WorkerFit {
  const steps = [undefined, ...WALK_CYCLE.keys()];
  let fit: WorkerFit = { height, side: 0, above: 0, below: 0 };
  const include = (input: Omit<WorkerInput, "height">) => {
    const { behind, front } = workerShapes({ ...input, height });
    const b = shapesBounds([...behind, ...front]);
    fit = { height, side: Math.max(fit.side, -b.left, b.right), above: Math.max(fit.above, -b.top), below: Math.max(fit.below, b.bottom) };
  };
  for (const step of steps) include({ pose: "stand", step });
  include({ pose: "carry-head" });
  // Pushing depends on how far the feet are from the cabinet's level, which depends on the fit.
  const seen = new Set<number>();
  for (let changed = true; changed; ) {
    changed = false;
    for (let row = 0; row < wall.rows; row++) {
      const rowBottom = (row + 1) * wall.cabinet.height;
      const lift = lowFeet(wall, rowBottom, fit) - rowBottom;
      if (seen.has(lift)) continue;
      seen.add(lift);
      changed = true;
      for (const step of steps) include({ pose: "place", step, lift, cabinet: wall.cabinet });
    }
  }
  return fit;
}

/** Below this a worker is a smudge, and the wall builds without one. */
export const MIN_WORKER_HEIGHT = 8;

/** The largest worker, up to `normal`, that stays inside the wall. Null when that's too small to draw. */
export function fitWorker(wall: LowWall, normal: number): WorkerFit | null {
  for (let height = normal; height >= MIN_WORKER_HEIGHT; ) {
    const fit = measure(wall, height);
    if (fit.above + fit.below <= wall.height && 2 * fit.side <= wall.width) return fit;
    // Reach grows with height, so jump close to the answer, then step down.
    const guess = Math.floor(height * Math.min(wall.height / (fit.above + fit.below), wall.width / (2 * fit.side)));
    height = Math.min(height - 1, guess + 2);
  }
  return null;
}
