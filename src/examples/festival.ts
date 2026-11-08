import { BUILTIN_CABINETS } from "@/domain/cabinets";
import type { Project } from "@/domain/model";
import { mmToUm, px } from "@/domain/units";
import * as ops from "@/engines/project-ops";
import { exampleContext } from "./context";

/**
 * Festival Main Stage: the reusable showcase and test project, also kept as a file in
 * examples/festival-main-stage.pixellab.json for importing into the app.
 * Center Wall 3072×1536 P2.6 with a Header (3072×384) sharing its top band, two IMAGs
 * (768×1280 P3.91), a Ribbon (4608×128), and a DJ Booth (512×256) on its own canvas.
 * Master 5120×1664, two processor outputs, no validation errors.
 */
export function festivalMainStage(): Project {
  const ctx = exampleContext("show");
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
