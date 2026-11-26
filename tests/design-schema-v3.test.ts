import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "@/domain/model";
import { px } from "@/domain/units";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { cornersBounds, polygonsOverlap, rotatedCorners } from "@/engines/rotation";
import { validateProject } from "@/engines/validation";
import { festivalMainStage } from "@/examples/festival";
import { parseProjectFile, serializeProject } from "@/persistence/schema";
import { threeScreenProject } from "./helpers";

const read = (f: string) => readFileSync(`tests/fixtures/${f}`, "utf8");

describe("schema 3", () => {
  it("is version 3", () => expect(SCHEMA_VERSION).toBe(3));

  it("a schema 2 file loads unchanged apart from the version, and maps exactly as the current example", () => {
    const v2 = JSON.parse(read("festival-main-stage.schema-2.pixellab.json")).project;
    expect(v2.schemaVersion).toBe(2);
    const loaded = parseProjectFile(read("festival-main-stage.schema-2.pixellab.json"));
    expect(loaded).toEqual({ ...v2, schemaVersion: 3 });
    expect(resolveMapping(loaded)).toEqual(resolveMapping(festivalMainStage()));
  });

  it("an unsplit, unrotated screen has one part, the whole screen, and no new fields are written", () => {
    const p = festivalMainStage();
    for (const s of resolveMapping(p).screens) {
      expect(s.parts).toHaveLength(1);
      expect(s.parts[0]).toMatchObject({ index: 1, count: 1, outputId: s.outputId, outputRect: s.outputRect, source: { x: 0, y: 0, width: s.spec.pixelWidth, height: s.spec.pixelHeight } });
      expect(s.rotation).toBe(0);
      expect(s.flip).toBe("none");
    }
    const text = serializeProject(p);
    expect(text).not.toMatch(/"parts"|"rotation"|"flip"/);
  });

  it("parts, rotation and flip survive save and load", () => {
    const { project, ids } = threeScreenProject();
    const m = resolveMapping(project).screens.find((s) => s.screenId === ids.center)!;
    const half = m.cabinet.pixelsX * Math.floor(m.columns / 2);
    const out2 = ops.addOutput(project, "Second", { newId: () => "out-2", now: () => "x" });
    let p = ops.setSliceParts(out2.project, ids.center, [
      { outputId: m.outputId, x: px(0), y: px(0), source: { x: px(0), y: px(0), width: px(half), height: m.spec.pixelHeight } },
      { outputId: "out-2", x: px(0), y: px(0), source: { x: px(half), y: px(0), width: px(m.spec.pixelWidth - half), height: m.spec.pixelHeight } },
    ]);
    p = ops.setRegionFlip(ops.setRegionRotation(p, ids.left, 45), ids.left, "h");
    const loaded = parseProjectFile(serializeProject(p));
    expect(loaded).toEqual(p);
    const s = resolveMapping(loaded).screens.find((x) => x.screenId === ids.center)!;
    expect(s.parts.map((q) => [q.index, q.count, q.outputId, q.source.x, q.masterRect.x - s.masterRect.x])).toEqual([[1, 2, m.outputId, 0, 0], [2, 2, "out-2", half, half]]);
    expect(resolveMapping(loaded).outputs.find((o) => o.outputId === "out-2")!.screenIds).toEqual([ids.center]);
    const left = resolveMapping(loaded).screens.find((x) => x.screenId === ids.left)!;
    expect([left.rotation, left.flip]).toEqual([45, "h"]);
    // Back to 0 and none: the fields go away again.
    const back = ops.setRegionFlip(ops.setRegionRotation(loaded, ids.left, 0), ids.left, "none");
    expect(back.content.regions.find((r) => r.screenId === ids.left)).not.toHaveProperty("rotation");
    expect(back.content.regions.find((r) => r.screenId === ids.left)).not.toHaveProperty("flip");
  });

  it("refuses a split that cuts a cabinet, overlaps, or doesn't cover the screen", () => {
    const { project, ids } = threeScreenProject();
    const m = resolveMapping(project).screens.find((s) => s.screenId === ids.center)!;
    const full = { x: px(0), y: px(0), width: m.spec.pixelWidth, height: m.spec.pixelHeight };
    const part = (x: number, w: number) => ({ outputId: m.outputId, x: px(0), y: px(0), source: { ...full, x: px(x), width: px(w) } });
    const c = m.cabinet.pixelsX;
    expect(() => ops.setSliceParts(project, ids.center, [part(0, c + 1), part(c + 1, m.spec.pixelWidth - c - 1)])).toThrow(/cuts through a cabinet/);
    expect(() => ops.setSliceParts(project, ids.center, [part(0, 2 * c), part(c, m.spec.pixelWidth - c)])).toThrow(/overlaps/);
    expect(() => ops.setSliceParts(project, ids.center, [part(0, c), part(c, c)])).toThrow(/must be the whole screen/);
    expect(() => ops.setSliceParts(project, ids.center, [part(0, m.spec.pixelWidth)])).toThrow(/at least two parts/);
  });

  it("validation: parts of one screen overlapping in an output, and a resize drops the split", () => {
    const { project, ids } = threeScreenProject();
    const m = resolveMapping(project).screens.find((s) => s.screenId === ids.center)!;
    const c = m.cabinet.pixelsX;
    const full = { x: px(0), y: px(0), width: m.spec.pixelWidth, height: m.spec.pixelHeight };
    const p = ops.setSliceParts(project, ids.center, [
      { outputId: m.outputId, x: px(5000), y: px(0), source: { ...full, width: px(c) } },
      { outputId: m.outputId, x: px(5000), y: px(0), source: { ...full, x: px(c), width: px(m.spec.pixelWidth - c) } },
    ]);
    const issues = validateProject(p, resolveMapping(p));
    expect(issues.some((i) => i.code === "SLICE_OVERLAP" && i.message.includes("part 1/2") && i.message.includes("part 2/2"))).toBe(true);
    const resized = ops.updateScreen(p, ids.center, { columns: m.columns + 1 });
    expect(resized.output.slices.find((s) => s.screenId === ids.center)).not.toHaveProperty("parts");
    expect(() => ops.assignOutput(p, ids.center, m.outputId)).toThrow(/split across outputs/);
  });
});

describe("rotation", () => {
  it("45° turns corners about the centre, clockwise on screen", () => {
    const c = rotatedCorners({ x: 0, y: 0, width: 200, height: 100 }, 45);
    const r = Math.SQRT1_2;
    const expect4 = [[-100, -50], [100, -50], [100, 50], [-100, 50]].map(([dx, dy]) => ({ x: 100 + dx * r - dy * r, y: 50 + dx * r + dy * r }));
    c.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expect4[i].x, 6);
      expect(p.y).toBeCloseTo(expect4[i].y, 6);
    });
    // The top-right corner moves down: clockwise on a y-down screen.
    expect(c[1].y).toBeGreaterThan(-50 + 50);
    expect(rotatedCorners({ x: 3, y: 4, width: 10, height: 20 }, 0)).toEqual([{ x: 3, y: 4 }, { x: 13, y: 4 }, { x: 13, y: 24 }, { x: 3, y: 24 }]);
    expect(cornersBounds(rotatedCorners({ x: 0, y: 0, width: 100, height: 100 }, 90))).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("overlap uses the real polygon: a 45° square clears a neighbour its bounding box would hit", () => {
    const diamond = rotatedCorners({ x: 0, y: 0, width: 100, height: 100 }, 45);
    const corner = rotatedCorners({ x: 105, y: 105, width: 20, height: 20 }, 0);
    expect(polygonsOverlap(diamond, corner)).toBe(false);
    expect(polygonsOverlap(diamond, rotatedCorners({ x: 40, y: 40, width: 20, height: 20 }, 0))).toBe(true);
    // Touching edges are not an overlap.
    expect(polygonsOverlap(rotatedCorners({ x: 0, y: 0, width: 10, height: 10 }, 0), rotatedCorners({ x: 10, y: 0, width: 10, height: 10 }, 0))).toBe(false);
  });

  it("a rotated region is validated by its polygon and widens the auto master to the pixels it reaches", () => {
    const { project, ids } = threeScreenProject();
    const before = resolveMapping(project);
    const p = ops.setRegionRotation(project, ids.left, 90);
    const m = resolveMapping(p);
    const left = m.screens.find((s) => s.screenId === ids.left)!;
    expect(left.masterRect).toEqual(before.screens.find((s) => s.screenId === ids.left)!.masterRect);
    expect(left.outputRect).toEqual(before.screens.find((s) => s.screenId === ids.left)!.outputRect);
    expect(cornersBounds(left.masterCorners)).not.toEqual(left.masterRect);
  });
});
