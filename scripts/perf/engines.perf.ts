import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { BUILTIN_CABINETS } from "@/domain/cabinets";
import { px } from "@/domain/units";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { validateProject } from "@/engines/validation";
import { buildManifest } from "@/exports/manifest";
import { masterScene } from "@/exports/scene";
import { renderSvg } from "@/exports/svg";
import { serializeProject } from "@/persistence/schema";

/** Times the pure engines and writes the stress fixtures used in the browser. See docs/development/PERFORMANCE.md. */
const OUT = process.env.PERF_OUT ?? ".perf";
const cabinet = BUILTIN_CABINETS[0];
let id = 0;
const ctx: ops.OpContext = { newId: () => `id-${++id}`, now: () => "2026-01-01T00:00:00.000Z" };

function grid(name: string, across: number, down: number, columns: number, rows: number) {
  let project = ops.addCabinet(ops.createProject({ name }, ctx), cabinet);
  for (let i = 0; i < across * down; i++) {
    project = ops.addScreen(project, { name: `S${i + 1}`, cabinetId: cabinet.id, columns, rows }, ctx);
  }
  project.physical.screens.forEach((screen, i) => {
    project = ops.setRegionPosition(project, screen.id, px((i % across) * columns * cabinet.pixelsX), px(Math.floor(i / across) * rows * cabinet.pixelsY));
  });
  return project;
}

function median(work: () => unknown, runs = 25): string {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    work();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)].toFixed(2);
}

it("measures engines and writes fixtures", () => {
  const fixtures = {
    small: grid("perf-small", 3, 1, 4, 6),
    medium: grid("perf-medium", 5, 4, 4, 6),
    large: grid("perf-large", 10, 10, 4, 5),
    n500: grid("perf-500", 25, 20, 2, 2),
    limit: grid("perf-limit", 1, 1, 128, 64),
  };
  mkdirSync(OUT, { recursive: true });
  const header = "fixture | screens | cabinets | master | resolve ms | validate ms | scene+SVG ms | manifest ms";
  const rows = Object.entries(fixtures).map(([name, project]) => {
    writeFileSync(`${OUT}/${name}.json`, serializeProject(project));
    const mapping = resolveMapping(project);
    const issues = validateProject(project, mapping);
    return [
      name,
      project.physical.screens.length,
      mapping.screens.reduce((sum, s) => sum + s.spec.cabinetCount, 0),
      `${mapping.master.width}x${mapping.master.height}`,
      median(() => resolveMapping(project)),
      median(() => validateProject(project, mapping)),
      median(() => renderSvg(masterScene(mapping, "t")), 9),
      median(() => JSON.stringify(buildManifest(project, mapping, issues, "t"))),
    ].join(" | ");
  });
  writeFileSync(`${OUT}/engines.txt`, [header, ...rows].join("\n") + "\n");
});
