import { BUILTIN_CABINETS } from "@/domain/cabinets";
import type { CabinetProfile, Project } from "@/domain/model";
import { mmToUm, px } from "@/domain/units";
import * as ops from "@/engines/project-ops";

export function testContext(): ops.OpContext {
  let n = 0;
  return { newId: () => `id-${++n}`, now: () => "2026-11-07T00:00:00.000Z" };
}

export const CAB: CabinetProfile = {
  id: "cab-500",
  name: "500×500 P3.91",
  widthUm: mmToUm(500),
  heightUm: mmToUm(500),
  pixelsX: px(128),
  pixelsY: px(128),
  nominalPitchUm: mmToUm(3.91),
  source: "custom",
};

/** Left 4×6 (512×768), Center 12×6 (1536×768), Right 3×5 (384×640), placed edge to edge. */
export function threeScreenProject(ctx = testContext()): { project: Project; ids: { left: string; center: string; right: string } } {
  let project = ops.addCabinet(ops.createProject({ name: "Test show" }, ctx), CAB);
  project = ops.addScreen(project, { name: "Left", cabinetId: CAB.id, columns: 4, rows: 6 }, ctx);
  project = ops.addScreen(project, { name: "Center", cabinetId: CAB.id, columns: 12, rows: 6 }, ctx);
  project = ops.addScreen(project, { name: "Right", cabinetId: CAB.id, columns: 3, rows: 5 }, ctx);
  const [left, center, right] = project.physical.screens.map((s) => s.id);
  return { project, ids: { left, center, right } };
}

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
export function motionLabProject(ctx = testContext()) {
  let project = ops.addCabinet(ops.addCabinet(ops.createProject({ name: "Motion Lab acceptance" }, ctx), CAB), CAB_192);
  project = ops.addScreen(project, { name: "Left", cabinetId: CAB.id, columns: 6, rows: 4 }, ctx);
  project = ops.addScreen(project, { name: "Center", cabinetId: CAB_192.id, columns: 8, rows: 4 }, ctx);
  project = ops.addScreen(project, { name: "Side", cabinetId: CAB.id, columns: 4, rows: 6 }, ctx);
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

/**
 * Festival Main Stage: the reusable showcase and test project, also kept as a file in
 * examples/festival-main-stage.pixellab.json for importing into the app.
 * Center Wall 3072×1536 P2.6 with a Header (3072×384) sharing its top band, two IMAGs
 * (768×1280 P3.91), a Ribbon (4608×128), and a DJ Booth (512×256) on its own canvas.
 * Master 5120×1664, two processor outputs, no validation errors.
 */
export function festivalMainStage(): Project {
  let n = 0;
  const ctx: ops.OpContext = { newId: () => `show-${++n}`, now: () => "2026-11-07T00:00:00.000Z" };
  const P39 = BUILTIN_CABINETS.find((c) => c.id === "builtin-500x500-p391")!;
  const P26 = BUILTIN_CABINETS.find((c) => c.id === "builtin-500x500-p26")!;
  let p = ops.createProject({ name: "Festival Main Stage", client: "Playground Studio", venue: "Demo" }, ctx);
  p = ops.addCabinet(ops.addCabinet(p, P39), P26);
  const add = (name: string, cabinetId: string, columns: number, rows: number) => (p = ops.addScreen(p, { name, cabinetId, columns, rows }, ctx));
  add("Center Wall", P26.id, 16, 8);
  add("IMAG Left", P39.id, 6, 10);
  add("IMAG Right", P39.id, 6, 10);
  add("Header", P26.id, 16, 2);
  add("Ribbon", P39.id, 36, 1);
  add("DJ Booth", P39.id, 4, 2);
  const id = Object.fromEntries(p.physical.screens.map((s) => [s.name, s.id]));

  p = ops.setStagePositions(p, [
    { id: id["IMAG Left"], x: mmToUm(0), y: mmToUm(1000) },
    { id: id["Center Wall"], x: mmToUm(4000), y: mmToUm(1500) },
    { id: id["IMAG Right"], x: mmToUm(13000), y: mmToUm(1000) },
    { id: id["Header"], x: mmToUm(4000), y: mmToUm(0) },
    { id: id["Ribbon"], x: mmToUm(-1000), y: mmToUm(6500) },
    { id: id["DJ Booth"], x: mmToUm(7000), y: mmToUm(7500) },
  ]);

  p = ops.setRegionPosition(p, id["IMAG Left"], px(0), px(128));
  p = ops.setRegionPosition(p, id["Center Wall"], px(768), px(0));
  p = ops.setRegionPosition(p, id["IMAG Right"], px(3840), px(128));
  p = ops.setRegionPosition(p, id["Header"], px(768), px(0));
  p = ops.setRegionShared(ops.setRegionShared(p, id["Center Wall"], true), id["Header"], true);
  p = ops.setRegionPosition(p, id["Ribbon"], px(0), px(1536));
  p = ops.setRegionPosition(p, id["DJ Booth"], px(4608), px(0));
  const booth = ops.makeScreenIndependent(p, id["DJ Booth"], ctx);
  p = ops.updateCanvas(booth.project, booth.canvasId, { name: "DJ Booth canvas" });

  const processorB = ops.addOutput(p, "Processor B", ctx);
  p = ops.updateOutput(processorB.project, p.output.outputs[0].id, { name: "Processor A" });
  for (const name of ["IMAG Left", "IMAG Right", "Ribbon", "DJ Booth"]) p = ops.assignOutput(p, id[name], processorB.outputId);
  for (const s of p.physical.screens) p = ops.setSliceFollowsContent(p, s.id, false);
  return ops.setSlicePositions(p, [
    { id: id["Center Wall"], x: px(0), y: px(0) },
    { id: id["Header"], x: px(0), y: px(1536) },
    { id: id["IMAG Left"], x: px(0), y: px(0) },
    { id: id["IMAG Right"], x: px(768), y: px(0) },
    { id: id["DJ Booth"], x: px(1536), y: px(0) },
    { id: id["Ribbon"], x: px(0), y: px(1280) },
  ]);
}
