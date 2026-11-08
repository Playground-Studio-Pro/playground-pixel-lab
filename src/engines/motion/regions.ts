import type { Id } from "@/domain/model";
import type { Rect } from "@/domain/units";
import { intersection } from "@/engines/geometry";
import type { ResolvedMapping, ResolvedScreen } from "@/engines/mapping";
import type { ValidationIssue } from "@/engines/validation";

type R = Rect<number>;

/**
 * Where each screen's content comes from and where it's drawn. Pure.
 *
 * `source` is the screen's master rectangle from `resolveMapping`, and `dest` is the rectangle the
 * current workspace view already uses for that screen. Motion Lab computes no coordinates of its own.
 */
export interface PreviewRegion {
  readonly screenId: Id;
  readonly name: string;
  readonly color: string;
  /** Master canvas pixels. */
  readonly source: R;
  /** World units of the current view: micrometres on the stage, pixels otherwise. */
  readonly dest: R;
  /** One cabinet, in destination units, for guides. */
  readonly cellWidth: number;
  readonly cellHeight: number;
}

export interface ViewItemLike {
  readonly id: Id;
  readonly rect: R;
  readonly cellWidth: number;
  readonly cellHeight: number;
}

export function previewRegions(items: readonly ViewItemLike[], mapping: ResolvedMapping): PreviewRegion[] {
  const screens = new Map(mapping.screens.map((s) => [s.screenId, s]));
  return items.flatMap((item) => {
    const screen = screens.get(item.id);
    if (!screen) return [];
    return [{ screenId: item.id, name: screen.name, color: screen.color, source: screen.masterRect, dest: item.rect, cellWidth: item.cellWidth, cellHeight: item.cellHeight }];
  });
}

/** Maps a part of `from` to the same relative part of `to`. */
export function mapSubRect(sub: R, from: R, to: R): R {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return { x: to.x + (sub.x - from.x) * sx, y: to.y + (sub.y - from.y) * sy, width: sub.width * sx, height: sub.height * sy };
}

/**
 * - `shared`: content both screens mark as shared. Valid, and exportable.
 * - `conflict`: an overlap validation reports as an error. Shown, never blocked, in the preview.
 * - `stage`: screens overlapping on the stage plan. A warning, since they may sit at different depths.
 */
export type OverlapKind = "shared" | "conflict" | "stage";

export interface OverlapMark {
  readonly kind: OverlapKind;
  readonly screenIds: readonly [Id, Id];
  readonly label: string;
  /** Where to mark it, in the current view's world units: one rectangle per screen showing it. */
  readonly rects: readonly R[];
}

const KIND_BY_CODE: Partial<Record<ValidationIssue["code"], OverlapKind>> = {
  REGION_SHARED: "shared",
  REGION_OVERLAP: "conflict",
  SLICE_OVERLAP: "conflict",
  PHYSICAL_OVERLAP: "stage",
};

function sameRect(a: R, b: R) {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.width - b.width) < 1e-6 && Math.abs(a.height - b.height) < 1e-6;
}

/**
 * Overlaps to mark in the current view. Which overlaps are allowed comes from validation, so this
 * never applies a rule of its own; it only finds where each reported overlap appears on screen.
 */
export function overlapMarks(
  regions: readonly PreviewRegion[],
  issues: readonly ValidationIssue[],
  mapping: ResolvedMapping,
  view: "physical" | "content" | "output",
): OverlapMark[] {
  const screens = new Map(mapping.screens.map((s) => [s.screenId, s]));
  const shown = new Map(regions.map((r) => [r.screenId, r]));
  const marks: OverlapMark[] = [];

  for (const issue of issues) {
    const kind = KIND_BY_CODE[issue.code];
    if (!kind || issue.screenIds.length !== 2) continue;
    const [idA, idB] = issue.screenIds as [Id, Id];
    const a = screens.get(idA);
    const b = screens.get(idB);
    if (!a || !b) continue;

    let rects: R[] = [];
    let size: R | null = null;
    if (issue.code === "SLICE_OVERLAP") {
      // Output pixels: only drawn on the output view, where the world is that output.
      size = intersection(a.outputRect, b.outputRect);
      if (view === "output" && size && shown.has(idA) && shown.has(idB)) rects = [size];
    } else if (issue.code === "PHYSICAL_OVERLAP") {
      size = intersection(a.stage, b.stage);
      if (view === "physical" && size) rects = [size];
    } else {
      // Shared or conflicting content: the same master pixels, wherever each screen is drawn.
      size = intersection(a.masterRect, b.masterRect);
      if (size) {
        for (const screen of [a, b] as ResolvedScreen[]) {
          const region = shown.get(screen.screenId);
          if (!region) continue;
          const rect = mapSubRect(size, region.source, region.dest);
          if (!rects.some((r) => sameRect(r, rect))) rects.push(rect);
        }
      }
    }
    if (!size || rects.length === 0) continue;

    const dims = issue.code === "PHYSICAL_OVERLAP" ? `${Math.round(size.width / 1000)} × ${Math.round(size.height / 1000)} mm` : `${size.width} × ${size.height} px`;
    const label =
      kind === "shared" ? `Shared ${dims}` : kind === "stage" ? `Stage overlap ${dims}` : issue.code === "SLICE_OVERLAP" ? `Output conflict ${dims}` : `Content conflict ${dims}`;
    marks.push({ kind, screenIds: [idA, idB], label, rects });
  }
  return marks;
}
