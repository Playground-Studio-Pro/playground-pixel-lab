import type { Rect } from "@/domain/units";
import { bottom, right } from "./geometry";

export interface SnapOptions {
  /** Other items to snap edges to. Null disables edge snapping. */
  readonly others: readonly Rect<number>[] | null;
  /** Grid spacing in world units. Null disables grid snapping. */
  readonly gridStep: number | null;
  /** Maximum snap distance in world units. */
  readonly threshold: number;
}

export interface SnapGuide {
  readonly axis: "x" | "y";
  readonly position: number;
}

export interface SnapResult {
  readonly x: number;
  readonly y: number;
  readonly guides: readonly SnapGuide[];
}

interface Candidate {
  readonly delta: number;
  readonly guide: number | null;
}

function bestDelta(
  edges: readonly number[],
  targets: readonly number[],
  gridStep: number | null,
  threshold: number,
): Candidate | null {
  let best: Candidate | null = null;
  const consider = (delta: number, guide: number | null) => {
    if (Math.abs(delta) > threshold) return;
    // Item edges win ties over the grid, so aligned screens stay aligned.
    if (!best || Math.abs(delta) < Math.abs(best.delta) || (Math.abs(delta) === Math.abs(best.delta) && guide !== null && best.guide === null)) {
      best = { delta, guide };
    }
  };
  for (const edge of edges) {
    for (const target of targets) consider(target - edge, target);
  }
  if (gridStep) consider(Math.round(edges[0] / gridStep) * gridStep - edges[0], null);
  return best;
}

/** Snaps a moving rectangle's position on each axis independently. Pure and deterministic. */
export function snapPosition(moving: Rect<number>, options: SnapOptions): SnapResult {
  const others = options.others ?? [];
  const xTargets = options.others ? [0, ...others.flatMap((o) => [o.x, right(o)])] : [];
  const yTargets = options.others ? [0, ...others.flatMap((o) => [o.y, bottom(o)])] : [];

  const snapX = bestDelta([moving.x, right(moving)], xTargets, options.gridStep, options.threshold);
  const snapY = bestDelta([moving.y, bottom(moving)], yTargets, options.gridStep, options.threshold);

  const guides: SnapGuide[] = [];
  if (snapX?.guide != null) guides.push({ axis: "x", position: snapX.guide });
  if (snapY?.guide != null) guides.push({ axis: "y", position: snapY.guide });

  return { x: moving.x + (snapX?.delta ?? 0), y: moving.y + (snapY?.delta ?? 0), guides };
}
