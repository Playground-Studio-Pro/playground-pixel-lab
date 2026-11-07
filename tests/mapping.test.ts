import { describe, expect, it } from "vitest";
import { px, um } from "@/domain/units";
import { boundingBox, overlaps, intersection } from "@/engines/geometry";
import { resolveMapping } from "@/engines/mapping";
import { computeScreenSpec, pitchDeviation } from "@/engines/physical";
import * as ops from "@/engines/project-ops";
import { CAB, testContext, threeScreenProject } from "./helpers";

describe("computeScreenSpec", () => {
  it("multiplies whole cabinets into pixels and micrometres", () => {
    const spec = computeScreenSpec({ columns: 12, rows: 6 }, CAB);
    expect(spec.pixelWidth).toBe(1536);
    expect(spec.pixelHeight).toBe(768);
    expect(spec.widthUm).toBe(6_000_000);
    expect(spec.heightUm).toBe(3_000_000);
    expect(spec.cabinetCount).toBe(72);
    expect(spec.totalPixels).toBe(1536 * 768);
  });

  it("uses exact cabinet pixels, not size ÷ pitch", () => {
    // 500 / 3.91 = 127.877…; the real cabinet is 128.
    expect(computeScreenSpec({ columns: 1, rows: 1 }, CAB).pixelWidth).toBe(128);
  });
});

describe("pitchDeviation", () => {
  it("is small for a correct profile and large for a wrong one", () => {
    expect(pitchDeviation(CAB)).toBeLessThan(0.01);
    expect(pitchDeviation({ ...CAB, nominalPitchUm: um(5000) })).toBeGreaterThan(0.2);
  });
});

describe("geometry", () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  it("treats touching edges as not overlapping", () => {
    expect(overlaps(a, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
    expect(overlaps(a, { x: 99, y: 0, width: 10, height: 10 })).toBe(true);
  });
  it("computes the exact intersection", () => {
    expect(intersection(a, { x: 90, y: 95, width: 50, height: 50 })).toEqual({ x: 90, y: 95, width: 10, height: 5 });
  });
  it("computes a tight bounding box", () => {
    expect(boundingBox([])).toBeNull();
    expect(boundingBox([{ x: 10, y: 20, width: 5, height: 5 }, { x: 30, y: 5, width: 10, height: 1 }])).toEqual({ x: 10, y: 5, width: 30, height: 20 });
  });
});

describe("resolveMapping", () => {
  it("calculates the master canvas for three different screens", () => {
    const { project } = threeScreenProject();
    const mapping = resolveMapping(project);
    expect(mapping.master).toMatchObject({ width: 2432, height: 768, sizing: "auto" });
    expect(mapping.screens.map((s) => [s.name, s.masterRect.x, s.masterRect.y, s.masterRect.width, s.masterRect.height])).toEqual([
      ["Left", 0, 0, 512, 768],
      ["Center", 512, 0, 1536, 768],
      ["Right", 2048, 0, 384, 640],
    ]);
  });

  it("extends the auto master to the furthest edge when screens are positioned", () => {
    const { project, ids } = threeScreenProject();
    const moved = ops.setRegionPosition(project, ids.right, px(2500), px(1000));
    const { master } = resolveMapping(moved);
    expect(master.width).toBe(2884);
    expect(master.height).toBe(1640);
  });

  it("keeps a fixed master at its set size", () => {
    const { project } = threeScreenProject();
    const { master } = resolveMapping(ops.setMasterSizing(project, { mode: "fixed", width: px(3840), height: px(2160) }));
    expect(master).toMatchObject({ width: 3840, height: 2160, sizing: "fixed" });
    expect(master.contentBounds).toMatchObject({ x: 0, y: 0, width: 2432, height: 768 });
  });

  it("adds the canvas origin to get master coordinates", () => {
    const ctx = testContext();
    const { project, ids } = threeScreenProject(ctx);
    const { project: withCanvas, canvasId } = ops.addCanvas(project, "IMAG", ctx);
    let next = ops.assignCanvas(withCanvas, ids.right, canvasId);
    next = ops.updateCanvas(next, canvasId, { originX: px(100), originY: px(1000) });
    next = ops.setRegionPosition(next, ids.right, px(16), px(32));
    const right = resolveMapping(next).screens.find((s) => s.screenId === ids.right)!;
    expect(right.canvasRect).toMatchObject({ x: 16, y: 32 });
    expect(right.masterRect).toMatchObject({ x: 116, y: 1032 });
  });

  it("computes each canvas's tight bounding box", () => {
    const { project } = threeScreenProject();
    const canvas = resolveMapping(project).canvases[0];
    expect(canvas.bounds).toMatchObject({ x: 0, y: 0, width: 2432, height: 768 });
    expect(canvas.screenIds).toHaveLength(3);
  });

  it("slices follow content until given a manual position", () => {
    const { project, ids } = threeScreenProject();
    const moved = ops.setRegionPosition(project, ids.left, px(40), px(80));
    expect(resolveMapping(moved).screens[0].outputRect).toMatchObject({ x: 40, y: 80 });

    const manual = ops.setSlicePositions(moved, [{ id: ids.left, x: px(0), y: px(1080) }]);
    const left = resolveMapping(manual).screens[0];
    expect(left.outputRect).toMatchObject({ x: 0, y: 1080 });
    expect(left.followsContent).toBe(false);
    expect(left.masterRect).toMatchObject({ x: 40, y: 80 });
  });

  it("keeps physical position independent of content and output", () => {
    const { project, ids } = threeScreenProject();
    const before = resolveMapping(project);
    const moved = resolveMapping(ops.setStagePositions(project, [{ id: ids.left, x: um(-5_000_000), y: um(250_000) }]));
    expect(moved.screens[0].stage.x).toBe(-5_000_000);
    expect(moved.screens[0].masterRect).toEqual(before.screens[0].masterRect);
    expect(moved.screens[0].outputRect).toEqual(before.screens[0].outputRect);
  });

  it("sizes an auto output from its slices", () => {
    const ctx = testContext();
    const { project, ids } = threeScreenProject(ctx);
    const { project: two, outputId } = ops.addOutput(project, "Output 2", ctx);
    let next = ops.assignOutput(two, ids.right, outputId);
    next = ops.setSlicePositions(next, [{ id: ids.right, x: px(0), y: px(0) }]);
    const mapping = resolveMapping(next);
    expect(mapping.outputs[0]).toMatchObject({ width: 2048, height: 768 });
    expect(mapping.outputs[1]).toMatchObject({ width: 384, height: 640 });
  });

  it("reports screens that can't resolve instead of failing", () => {
    const { project, ids } = threeScreenProject();
    const broken = { ...project, content: { ...project.content, regions: project.content.regions.filter((r) => r.screenId !== ids.left) } };
    const mapping = resolveMapping(broken);
    expect(mapping.unresolved).toEqual([{ screenId: ids.left, name: "Left", reason: "missing-region" }]);
    expect(mapping.screens).toHaveLength(2);
  });

  it("is deterministic and leaves the project unchanged", () => {
    const { project } = threeScreenProject();
    const before = JSON.stringify(project);
    expect(resolveMapping(project)).toEqual(resolveMapping(project));
    expect(JSON.stringify(project)).toBe(before);
  });

  it("produces only integer pixel coordinates", () => {
    const { project } = threeScreenProject();
    for (const s of resolveMapping(project).screens) {
      for (const v of [s.masterRect, s.canvasRect, s.outputRect].flatMap((r) => [r.x, r.y, r.width, r.height])) {
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
});
