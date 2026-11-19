import { BUILTIN_CABINETS } from "@/domain/cabinets";
import type { Project } from "@/domain/model";
import { mmToUm, px } from "@/domain/units";
import * as ops from "@/engines/project-ops";
import { exampleContext } from "@/examples/context";

/**
 * "Pixel test" (PHYSICAL_OUTPUT 8.10, O2): the project the pixel-grid checks and the Resolume procedure (8.11)
 * use. Master 1920 × 1080 and one output 1920 × 1080, both fixed, three screens, every master and output
 * offset odd and non-zero, so an off-by-one or an even-only assumption shows.
 *
 * | Screen | Cabinets | Size | Master | Output |
 * | Wall A | 6 × 4 P3.91 (128 × 128) | 768 × 512 | 101, 37 | 13, 7 |
 * | Wall B | 4 × 2 P2.6 (192 × 192) | 768 × 384 | 1003, 37 | 901, 7 |
 * | Strip C | 6 × 2 P5.95 (168 × 84) | 1008 × 168 | 101, 777 | 455, 899 |
 *
 * Saved as tests/fixtures/pixel-test.pixellab.json for opening in the app; `tests/pixel-grid.test.ts` keeps
 * the file equal to this builder (regenerate with `UPDATE_FIXTURES=1 npx vitest run tests/pixel-grid.test.ts`).
 */
export const PIXEL_TEST_LAYOUT = [
  { name: "Wall A", cabinet: "builtin-500x500-p391", columns: 6, rows: 4, master: [101, 37], output: [13, 7] },
  { name: "Wall B", cabinet: "builtin-500x500-p26", columns: 4, rows: 2, master: [1003, 37], output: [901, 7] },
  { name: "Strip C", cabinet: "builtin-1000x500-p595", columns: 6, rows: 2, master: [101, 777], output: [455, 899] },
] as const;

export function pixelTestProject(): Project {
  const ctx = exampleContext("pixel");
  let p = ops.createProject({ name: "Pixel test", client: "Playground Studio", venue: "Test bench" }, ctx);
  for (const id of new Set(PIXEL_TEST_LAYOUT.map((s) => s.cabinet))) p = ops.addCabinet(p, BUILTIN_CABINETS.find((c) => c.id === id)!);
  for (const s of PIXEL_TEST_LAYOUT) p = ops.addScreen(p, { name: s.name, cabinetId: s.cabinet, columns: s.columns, rows: s.rows }, ctx);
  const id = Object.fromEntries(p.physical.screens.map((s) => [s.name, s.id]));
  p = ops.setStagePositions(p, [
    { id: id["Wall A"], x: mmToUm(0), y: mmToUm(0) },
    { id: id["Wall B"], x: mmToUm(4000), y: mmToUm(0) },
    { id: id["Strip C"], x: mmToUm(0), y: mmToUm(3000) },
  ]);
  for (const s of PIXEL_TEST_LAYOUT) p = ops.setRegionPosition(p, id[s.name], px(s.master[0]), px(s.master[1]));
  p = ops.setMasterSizing(p, { mode: "fixed", width: px(1920), height: px(1080) });
  const outputId = p.output.outputs[0].id;
  p = ops.updateOutput(p, outputId, { name: "OUT 1", sizing: { mode: "fixed", width: px(1920), height: px(1080) } });
  for (const s of PIXEL_TEST_LAYOUT) p = ops.setSliceFollowsContent(p, id[s.name], false);
  return ops.setSlicePositions(
    p,
    PIXEL_TEST_LAYOUT.map((s) => ({ id: id[s.name], x: px(s.output[0]), y: px(s.output[1]) })),
  );
}
