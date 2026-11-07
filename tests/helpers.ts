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
