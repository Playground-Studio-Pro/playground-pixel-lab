import type { ResolvedMapping } from "@/engines/mapping";

/**
 * What a depth scene can be rendered for. Read from the resolved mapping and never stored: pixel sizes
 * and physical sizes stay owned by the mapping, so a scene can't drift out of step with the wall.
 */
export interface DepthTarget {
  /** `master`, `canvas:<id>` or `screen:<id>`. */
  readonly id: string;
  readonly kind: "master" | "canvas" | "screen";
  readonly name: string;
  /** Pixel size, in master space. */
  readonly widthPx: number;
  readonly heightPx: number;
  /** Physical size in metres, known only for a single screen. */
  readonly physical: { readonly widthM: number; readonly heightM: number } | null;
}

export const MASTER_TARGET_ID = "master";

const UM_PER_M = 1_000_000;

export function depthTargets(mapping: ResolvedMapping): DepthTarget[] {
  const targets: DepthTarget[] = [];
  if (mapping.master.width > 0 && mapping.master.height > 0) {
    targets.push({ id: MASTER_TARGET_ID, kind: "master", name: "Master canvas", widthPx: mapping.master.width, heightPx: mapping.master.height, physical: null });
  }
  // A canvas is worth listing only when it differs from the master and from a single screen.
  for (const canvas of mapping.canvases) {
    const b = canvas.bounds;
    if (!b || canvas.screenIds.length < 2) continue;
    if (b.width === mapping.master.width && b.height === mapping.master.height) continue;
    targets.push({ id: `canvas:${canvas.canvasId}`, kind: "canvas", name: canvas.name, widthPx: b.width, heightPx: b.height, physical: null });
  }
  for (const screen of mapping.screens) {
    targets.push({
      id: `screen:${screen.screenId}`,
      kind: "screen",
      name: screen.name,
      widthPx: screen.masterRect.width,
      heightPx: screen.masterRect.height,
      physical: screen.stage.width > 0 && screen.stage.height > 0 ? { widthM: screen.stage.width / UM_PER_M, heightM: screen.stage.height / UM_PER_M } : null,
    });
  }
  return targets;
}

/** The chosen target, or the first one when the choice no longer exists. Null when nothing is mapped. */
export function pickDepthTarget(targets: readonly DepthTarget[], id: string | null): DepthTarget | null {
  return targets.find((t) => t.id === id) ?? targets[0] ?? null;
}
