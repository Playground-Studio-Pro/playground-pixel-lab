import type { CabinetProfile } from "@/domain/model";
import { mmToUm, px } from "@/domain/units";
import * as ops from "@/engines/project-ops";
import { exampleContext } from "./context";

const CAB_500: CabinetProfile = {
  id: "cab-500",
  name: "500×500 P3.91",
  widthUm: mmToUm(500),
  heightUm: mmToUm(500),
  pixelsX: px(128),
  pixelsY: px(128),
  nominalPitchUm: mmToUm(3.91),
  source: "custom",
};

export const CAB_192: CabinetProfile = {
  id: "cab-192",
  name: "500×500 P2.6",
  widthUm: mmToUm(500),
  heightUm: mmToUm(500),
  pixelsX: px(192),
  pixelsY: px(192),
  nominalPitchUm: mmToUm(2.6),
  source: "custom",
};

/**
 * Motion Lab acceptance project. Three screens with different resolutions and stage positions:
 * - Left 6×4 of 128 px (768×512) and Center 8×4 of 192 px (1536×768) share the main canvas, and
 *   intentionally overlap by 256×512 px, both marked as sharing content.
 * - Side 4×6 of 128 px (512×768) has its own, independent canvas.
 * Output slices are placed side by side, so the project has no errors and every export is enabled.
 */
export function motionLabProject(ctx: ops.OpContext = exampleContext("id")) {
  let project = ops.addCabinet(ops.addCabinet(ops.createProject({ name: "Motion Lab acceptance" }, ctx), CAB_500), CAB_192);
  project = ops.addScreen(project, { name: "Left", cabinetId: CAB_500.id, columns: 6, rows: 4 }, ctx);
  project = ops.addScreen(project, { name: "Center", cabinetId: CAB_192.id, columns: 8, rows: 4 }, ctx);
  project = ops.addScreen(project, { name: "Side", cabinetId: CAB_500.id, columns: 4, rows: 6 }, ctx);
  const [left, center, side] = project.physical.screens.map((s) => s.id);

  project = ops.setStagePositions(project, [
    { id: left, x: mmToUm(0), y: mmToUm(500) },
    { id: center, x: mmToUm(3500), y: mmToUm(0) },
    { id: side, x: mmToUm(8500), y: mmToUm(250) },
  ]);
  project = ops.setRegionPosition(project, left, px(0), px(128));
  project = ops.setRegionPosition(project, center, px(512), px(0));
  project = ops.setRegionShared(ops.setRegionShared(project, left, true), center, true);
  project = ops.setRegionPosition(project, side, px(2176), px(0));
  const independent = ops.makeScreenIndependent(project, side, ctx);
  project = ops.updateCanvas(independent.project, independent.canvasId, { name: "Side canvas" });

  for (const id of [left, center, side]) project = ops.setSliceFollowsContent(project, id, false);
  project = ops.setSlicePositions(project, [
    { id: left, x: px(0), y: px(0) },
    { id: center, x: px(768), y: px(0) },
    { id: side, x: px(2304), y: px(0) },
  ]);
  return { project, ids: { left, center, side }, sideCanvasId: independent.canvasId };
}
