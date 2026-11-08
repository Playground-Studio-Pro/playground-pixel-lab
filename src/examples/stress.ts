import { BUILTIN_CABINETS } from "@/domain/cabinets";
import type { Project } from "@/domain/model";
import { px } from "@/domain/units";
import * as ops from "@/engines/project-ops";
import { exampleContext } from "./context";

/** Stress test: 500 identical 2×2 screens (256×256) in a 25×20 grid, the shape of the perf-500 fixture. */
export function stress500(): Project {
  const ctx = exampleContext("stress");
  const cabinet = BUILTIN_CABINETS[0];
  const across = 25;
  let p = ops.addCabinet(ops.createProject({ name: "Stress test, 500 screens" }, ctx), cabinet);
  for (let i = 0; i < 500; i++) p = ops.addScreen(p, { name: `S${i + 1}`, cabinetId: cabinet.id, columns: 2, rows: 2 }, ctx);
  p.physical.screens.forEach((screen, i) => {
    p = ops.setRegionPosition(p, screen.id, px((i % across) * 256), px(Math.floor(i / across) * 256));
  });
  return p;
}
