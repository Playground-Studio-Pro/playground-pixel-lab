import { BUILTIN_CABINETS } from "@/domain/cabinets";
import type { Project } from "@/domain/model";
import { mmToUm, px } from "@/domain/units";
import * as ops from "@/engines/project-ops";
import { exampleContext } from "./context";

/**
 * Corporate Keynote: a 2688×1536 center wall (14×8 P2.6) between two portrait side screens
 * (4×8, 768×1536), one metre apart on stage, edge to edge on one 4224×1536 canvas and one output.
 */
export function corporateKeynote(): Project {
  const ctx = exampleContext("keynote");
  const P26 = BUILTIN_CABINETS.find((c) => c.id === "builtin-500x500-p26")!;
  let p = ops.addCabinet(ops.createProject({ name: "Corporate Keynote", client: "Playground Studio", venue: "Demo" }, ctx), P26);
  p = ops.addScreen(p, { name: "Left Side", cabinetId: P26.id, columns: 4, rows: 8 }, ctx);
  p = ops.addScreen(p, { name: "Main Wall", cabinetId: P26.id, columns: 14, rows: 8 }, ctx);
  p = ops.addScreen(p, { name: "Right Side", cabinetId: P26.id, columns: 4, rows: 8 }, ctx);
  const [left, main, right] = p.physical.screens.map((s) => s.id);
  p = ops.setStagePositions(p, [
    { id: left, x: mmToUm(0), y: mmToUm(0) },
    { id: main, x: mmToUm(3000), y: mmToUm(0) },
    { id: right, x: mmToUm(11000), y: mmToUm(0) },
  ]);
  p = ops.setRegionPosition(p, left, px(0), px(0));
  p = ops.setRegionPosition(p, main, px(768), px(0));
  p = ops.setRegionPosition(p, right, px(3456), px(0));
  return ops.updateOutput(p, p.output.outputs[0].id, { name: "Media server" });
}
