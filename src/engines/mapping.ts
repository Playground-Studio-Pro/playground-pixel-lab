import type { CabinetProfile, CanvasSizing, ContentFlip, Id, Project } from "@/domain/model";
import { px, type PixelRect, type Px, type StageRect } from "@/domain/units";
import { bottom, boundingBox, right } from "./geometry";
import { computeScreenSpec, stageRect, type ScreenSpec } from "./physical";
import { cornersBounds, normalizeDegrees, rotatedCorners, type Corners } from "./rotation";

/** One part of a screen in an output. An unsplit screen has exactly one part: the whole screen. */
export interface ResolvedPart {
  /** 1-based, and how many parts the screen has. */
  readonly index: number;
  readonly count: number;
  readonly outputId: Id;
  /** Where the part sits in its output, 1:1. */
  readonly outputRect: PixelRect<"output">;
  /** The part's region in the screen's own pixels. */
  readonly source: { readonly x: Px; readonly y: Px; readonly width: Px; readonly height: Px };
  /** The part's region on the master canvas, before rotation. */
  readonly masterRect: PixelRect<"master">;
  /** Its corners on the master canvas, turned with the screen about the screen's centre. */
  readonly masterCorners: Corners;
}

export interface ResolvedScreen {
  readonly screenId: Id;
  readonly name: string;
  readonly color: string;
  readonly groupId: Id | null;
  readonly cabinet: CabinetProfile;
  readonly columns: number;
  readonly rows: number;
  readonly spec: ScreenSpec;
  readonly stage: StageRect;
  readonly canvasId: Id;
  readonly canvasRect: PixelRect<"canvas">;
  readonly masterRect: PixelRect<"master">;
  readonly allowOverlap: boolean;
  /** The first part's output and rectangle: the whole screen when it isn't split. */
  readonly outputId: Id;
  readonly outputRect: PixelRect<"output">;
  readonly followsContent: boolean;
  /** Every part in order. One part, the whole screen, when the screen isn't split. */
  readonly parts: readonly ResolvedPart[];
  /** Rotation of the content region about its centre, degrees in (-180, 180], positive clockwise. 0 when not set. */
  readonly rotation: number;
  readonly flip: ContentFlip;
  /** Corners of the content region on the master canvas after rotation; `masterRect`'s corners when not rotated. */
  readonly masterCorners: Corners;
}

export interface UnresolvedScreen {
  readonly screenId: Id;
  readonly name: string;
  readonly reason: "missing-cabinet" | "missing-region" | "missing-canvas" | "missing-slice" | "missing-output";
}

export interface ResolvedCanvas {
  readonly canvasId: Id;
  readonly name: string;
  readonly originX: Px;
  readonly originY: Px;
  readonly screenIds: readonly Id[];
  /** Tight bounding box of the canvas's regions. Null when it has none. */
  readonly bounds: PixelRect<"master"> | null;
}

export interface ResolvedMaster {
  readonly width: Px;
  readonly height: Px;
  readonly sizing: CanvasSizing["mode"];
  /** Tight bounding box of all regions. Null when there are none. */
  readonly contentBounds: PixelRect<"master"> | null;
}

export interface ResolvedOutput {
  readonly outputId: Id;
  readonly name: string;
  readonly width: Px;
  readonly height: Px;
  readonly sizing: CanvasSizing["mode"];
  readonly screenIds: readonly Id[];
}

export interface ResolvedMapping {
  readonly screens: readonly ResolvedScreen[];
  readonly unresolved: readonly UnresolvedScreen[];
  readonly canvases: readonly ResolvedCanvas[];
  readonly master: ResolvedMaster;
  readonly outputs: readonly ResolvedOutput[];
}

function pixelRect<S extends "master" | "canvas" | "output">(space: S, x: number, y: number, w: number, h: number): PixelRect<S> {
  return { space, x: px(x), y: px(y), width: px(w), height: px(h) };
}

/** Auto size extends from the origin to the furthest edge, so coordinates stay valid in Resolume without any offset. */
function resolveSize(sizing: CanvasSizing, rects: readonly { x: number; y: number; width: number; height: number }[]) {
  if (sizing.mode === "fixed") return { width: sizing.width, height: sizing.height };
  return {
    width: px(Math.max(0, ...rects.map(right))),
    height: px(Math.max(0, ...rects.map(bottom))),
  };
}

/** Combines the three layouts into exact final coordinates. Pure: output depends only on the project. */
export function resolveMapping(project: Project): ResolvedMapping {
  const cabinets = new Map(project.cabinets.map((c) => [c.id, c]));
  const canvases = new Map(project.content.canvases.map((c) => [c.id, c]));
  const regions = new Map(project.content.regions.map((r) => [r.screenId, r]));
  const slices = new Map(project.output.slices.map((s) => [s.screenId, s]));
  const outputs = new Map(project.output.outputs.map((o) => [o.id, o]));

  const screens: ResolvedScreen[] = [];
  const unresolved: UnresolvedScreen[] = [];

  for (const screen of project.physical.screens) {
    const fail = (reason: UnresolvedScreen["reason"]) => unresolved.push({ screenId: screen.id, name: screen.name, reason });
    const cabinet = cabinets.get(screen.cabinetId);
    if (!cabinet) { fail("missing-cabinet"); continue; }
    const region = regions.get(screen.id);
    if (!region) { fail("missing-region"); continue; }
    const canvas = canvases.get(region.canvasId);
    if (!canvas) { fail("missing-canvas"); continue; }
    const slice = slices.get(screen.id);
    if (!slice) { fail("missing-slice"); continue; }
    if (!outputs.has(slice.outputId)) { fail("missing-output"); continue; }

    const spec = computeScreenSpec(screen, cabinet);
    const masterX = canvas.originX + region.x;
    const masterY = canvas.originY + region.y;
    const masterRect = pixelRect("master", masterX, masterY, spec.pixelWidth, spec.pixelHeight);
    const rotation = normalizeDegrees(region.rotation ?? 0);
    const centre = { x: masterX + spec.pixelWidth / 2, y: masterY + spec.pixelHeight / 2 };
    const sourceParts = slice.parts?.length
      ? slice.parts
      : [{ outputId: slice.outputId, x: slice.followsContent ? masterX : slice.x, y: slice.followsContent ? masterY : slice.y, source: { x: px(0), y: px(0), width: spec.pixelWidth, height: spec.pixelHeight } }];
    if (sourceParts.some((p) => !outputs.has(p.outputId))) { fail("missing-output"); continue; }
    const parts: ResolvedPart[] = sourceParts.map((p, i) => {
      const partMaster = pixelRect("master", masterX + p.source.x, masterY + p.source.y, p.source.width, p.source.height);
      return {
        index: i + 1,
        count: sourceParts.length,
        outputId: p.outputId,
        outputRect: pixelRect("output", p.x, p.y, p.source.width, p.source.height),
        source: p.source,
        masterRect: partMaster,
        masterCorners: rotatedCorners(partMaster, rotation, centre),
      };
    });

    screens.push({
      screenId: screen.id,
      name: screen.name,
      color: screen.color,
      groupId: screen.groupId,
      cabinet,
      columns: screen.columns,
      rows: screen.rows,
      spec,
      stage: stageRect(screen, spec),
      canvasId: canvas.id,
      canvasRect: pixelRect("canvas", region.x, region.y, spec.pixelWidth, spec.pixelHeight),
      masterRect,
      allowOverlap: region.allowOverlap,
      outputId: parts[0].outputId,
      outputRect: parts[0].outputRect,
      followsContent: !slice.parts?.length && slice.followsContent,
      parts,
      rotation,
      flip: region.flip ?? "none",
      masterCorners: rotatedCorners(masterRect, rotation),
    });
  }

  // A rotated region counts by the whole pixels its corners reach; an unrotated one by its rectangle, as before.
  const masterRects = screens.map((s) => (s.rotation === 0 ? s.masterRect : cornersBounds(s.masterCorners)));
  const masterSize = resolveSize(project.content.master, masterRects);
  const tight = boundingBox(masterRects);

  return {
    screens,
    unresolved,
    master: {
      ...masterSize,
      sizing: project.content.master.mode,
      contentBounds: tight && pixelRect("master", tight.x, tight.y, tight.width, tight.height),
    },
    canvases: project.content.canvases.map((canvas) => {
      const members = screens.filter((s) => s.canvasId === canvas.id);
      const box = boundingBox(members.map((s) => (s.rotation === 0 ? s.masterRect : cornersBounds(s.masterCorners))));
      return {
        canvasId: canvas.id,
        name: canvas.name,
        originX: canvas.originX,
        originY: canvas.originY,
        screenIds: members.map((s) => s.screenId),
        bounds: box && pixelRect("master", box.x, box.y, box.width, box.height),
      };
    }),
    outputs: project.output.outputs.map((output) => {
      const members = screens.filter((s) => s.parts.some((p) => p.outputId === output.id));
      return {
        outputId: output.id,
        name: output.name,
        ...resolveSize(output.sizing, members.flatMap((s) => s.parts.filter((p) => p.outputId === output.id).map((p) => p.outputRect))),
        sizing: output.sizing.mode,
        screenIds: members.map((s) => s.screenId),
      };
    }),
  };
}
