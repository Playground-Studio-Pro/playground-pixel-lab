import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveMapping } from "@/engines/mapping";
import { expectedGridPixel, GRID, GRID_COLORS, gridPixelAt, motionMarkerOp, patternWhite, pixelGridOps, type GridOp } from "@/engines/pixel-grid";
import { validateProject } from "@/engines/validation";
import { videoTargets } from "@/engines/video-targets";
import { MODULE_SOURCES } from "@/modules/catalog";
import { createPixelGridSource, pixelGridSource } from "@/modules/output/pixel-grid-source";
import { parseProjectFile, serializeProject } from "@/persistence/schema";
import { PIXEL_TEST_LAYOUT, pixelTestProject } from "./fixtures/pixel-test";

const FIXTURE = "tests/fixtures/pixel-test.pixellab.json";
const label = { originX: 0, originY: 0, title: null };
const at = (w: number, h: number, x: number, y: number, motionFrame: number | null = null) => expectedGridPixel({ w, h }, label, { motionFrame }, x, y);

describe("pixel grid geometry (PHYSICAL_OUTPUT 8.7)", () => {
  it("every op is whole pixels, inside the rectangle, and the same for the same input", () => {
    for (const [w, h] of [[1920, 1080], [768, 512], [1008, 168], [64, 64], [5, 5], [1, 1], [3072, 1536]]) {
      const ops = pixelGridOps({ w, h }, { originX: 101, originY: 37, title: "SCR · test" }, { motionFrame: 7 });
      for (const op of ops) {
        for (const n of [op.x, op.y, op.w, op.h]) expect(Number.isSafeInteger(n)).toBe(true);
        expect(op.x >= 0 && op.y >= 0 && op.w >= 1 && op.h >= 1 && op.x + op.w <= w && op.y + op.h <= h, JSON.stringify(op)).toBe(true);
      }
      expect(pixelGridOps({ w, h }, { originX: 101, originY: 37, title: "SCR · test" }, { motionFrame: 7 })).toEqual(ops);
    }
  });

  it("edges: white outermost pixels, a black gap, a white inner line", () => {
    const [w, h] = [768, 512];
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [300, 0], [300, h - 1], [0, 300], [w - 1, 300]]) expect(at(w, h, x, y)).toEqual(GRID_COLORS.white);
    for (const [x, y] of [[300, 1], [300, h - 2], [1, 300], [w - 2, 300]]) expect(at(w, h, x, y)).toEqual(GRID_COLORS.black);
    for (const [x, y] of [[300, 2], [300, h - 3], [2, 300], [w - 3, 300]]) expect(at(w, h, x, y)).toEqual(GRID_COLORS.white);
  });

  it("corner markers: TL red, TR green, BL blue, BR white, 16 × 16 at inset 4, notched on their outer corner", () => {
    const [w, h] = [768, 512];
    const I = GRID.markerInset;
    const M = GRID.markerSize;
    expect(at(w, h, I + 1, I + 1)).toEqual(GRID_COLORS.red);
    expect(at(w, h, w - I - 2, I + 1)).toEqual(GRID_COLORS.green);
    expect(at(w, h, I + 1, h - I - 2)).toEqual(GRID_COLORS.blue);
    expect(at(w, h, w - I - 2, h - I - 2)).toEqual(GRID_COLORS.white);
    for (const [x, y] of [[I, I], [w - I - 1, I], [I, h - I - 1], [w - I - 1, h - I - 1]]) expect(at(w, h, x, y)).toEqual(GRID_COLORS.black);
    // The marker ends at inset 4 + 16: the next pixel is not red.
    expect(at(w, h, I + M - 1, I + 5)).toEqual(GRID_COLORS.red);
    expect(at(w, h, I + M, I + 5)).not.toEqual(GRID_COLORS.red);
  });

  it("grid lines every 10 px, lighter every 100 px", () => {
    expect(at(1920, 1080, 250, 55)).toEqual(GRID_COLORS.minor);
    expect(at(1920, 1080, 255, 50)).toEqual(GRID_COLORS.minor);
    expect(at(1920, 1080, 300, 47)).toEqual(GRID_COLORS.major);
    expect(at(1920, 1080, 255, 55)).toEqual(GRID_COLORS.black);
  });

  it("checker patches: 1 × 1 and 2 × 2 checker and stripes, white at each patch's own origin, origins even", () => {
    const ops = pixelGridOps({ w: 1920, h: 1080 }, label, { motionFrame: null });
    const patches = ops.filter((o): o is Extract<GridOp, { kind: "pattern" }> => o.kind === "pattern");
    expect(patches).toHaveLength(5 * 4);
    for (const p of patches) {
      expect(p.x % 2 + (p.y % 2)).toBe(0);
      expect([p.w, p.h]).toEqual([GRID.patch, GRID.patch]);
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [3, 3], [63, 63]]) {
        expect(gridPixelAt(ops, p.x + u, p.y + v)).toEqual(patternWhite(p.pattern, u, v) ? GRID_COLORS.white : GRID_COLORS.black);
      }
    }
    expect([patternWhite("checker-1", 1, 0), patternWhite("checker-2", 1, 0), patternWhite("checker-2", 2, 0), patternWhite("stripes-v", 1, 5), patternWhite("stripes-h", 5, 1)]).toEqual([false, true, false, false, false]);
  });

  it("small rectangles keep their edges and drop what doesn't fit, never shrinking it", () => {
    const ops = pixelGridOps({ w: 64, h: 32 }, { ...label, title: "Too long a title for this" }, { motionFrame: 0 });
    expect(ops.some((o) => o.kind === "pattern")).toBe(false);
    expect(ops.some((o) => o.kind === "text")).toBe(false);
    expect(at(64, 32, 0, 0)).toEqual(GRID_COLORS.white);
    expect(at(64, 32, 63, 31)).toEqual(GRID_COLORS.white);
    // 1 × 1: the edge line covers it; nothing else is drawn on top.
    expect(at(1, 1, 0, 0)).toEqual(GRID_COLORS.white);
    expect(pixelGridOps({ w: 1, h: 1 }, label, { motionFrame: 0 }).every((o) => o.kind === "rect")).toBe(true);
  });

  it("text boxes don't cover edges, markers, patches or the motion row, and print the rectangle's own coordinates", () => {
    const ops = pixelGridOps({ w: 768, h: 512 }, { originX: 101, originY: 37, title: "Wall A · 768 × 512 · master 101,37 · out 13,7" }, { motionFrame: null });
    const texts = ops.filter((o) => o.kind === "text");
    expect(texts.map((t) => t.kind === "text" && t.text)).toContain("301,237");
    expect(texts.map((t) => t.kind === "text" && t.text)).toContain("Wall A · 768 × 512 · master 101,37 · out 13,7");
    for (const t of texts) {
      expect(t.x >= 4 && t.y >= 4 && t.x + t.w <= 764 && t.y + t.h <= 508).toBe(true);
      for (const p of ops.filter((o) => o.kind === "pattern")) expect(t.x < p.x + p.w && p.x < t.x + t.w && t.y < p.y + p.h && p.y < t.y + t.h).toBe(false);
    }
    expect(gridPixelAt(ops, texts[0].x, texts[0].y)).toBe("text");
  });

  it("the motion marker steps 4 px per frame on row 24, wraps, and never covers the edge lines", () => {
    expect(motionMarkerOp({ w: 768, h: 512 }, 0)).toMatchObject({ x: 4, y: GRID.motionRow, w: 4, h: 4 });
    expect(motionMarkerOp({ w: 768, h: 512 }, 3)).toMatchObject({ x: 16 });
    expect(motionMarkerOp({ w: 768, h: 512 }, 190)).toMatchObject({ x: 4 });
    expect(motionMarkerOp({ w: 768, h: 512 }, 189)).toMatchObject({ x: 760 });
    expect(motionMarkerOp({ w: 11, h: 512 }, 2)).toBeNull();
    expect(motionMarkerOp({ w: 768, h: 31 }, 2)).toBeNull();
    expect(at(768, 512, 16, 25, 3)).toEqual(GRID_COLORS.white);
    expect(at(768, 512, 16, 25, 4)).not.toEqual(GRID_COLORS.white);
    for (let f = 0; f < 200; f++) for (const x of [0, 1, 2, 765, 766, 767]) expect(at(768, 512, x, 25, f)).toEqual(at(768, 512, x, 25, null));
  });
});

describe("pixel grid source", () => {
  it("is registered in the Output module and listed in the catalog under its id", () => {
    expect(pixelGridSource.id).toBe("pixel-grid");
    expect(MODULE_SOURCES.find((s) => s.id === "pixel-grid")?.moduleId).toBe("output");
  });

  it("draws master space only; display space belongs to the output page", () => {
    expect(() => createPixelGridSource({ space: "display", motion: false })).toThrow();
    expect(createPixelGridSource({ space: "master", motion: false }).id).toBe("pixel-grid");
  });
});

describe("Pixel test fixture", () => {
  const project = pixelTestProject();
  const mapping = resolveMapping(project);

  it("matches its file, parses, and validates with no errors", () => {
    const text = serializeProject(project);
    if (process.env.UPDATE_FIXTURES || !existsSync(FIXTURE)) writeFileSync(FIXTURE, text);
    expect(readFileSync(FIXTURE, "utf8")).toBe(text);
    expect(parseProjectFile(text)).toEqual(project);
    expect(validateProject(project, mapping).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("master and output are 1920 × 1080; every screen at its odd, non-zero master and output offset", () => {
    expect([mapping.master.width, mapping.master.height]).toEqual([1920, 1080]);
    expect(mapping.outputs.map((o) => [o.width, o.height])).toEqual([[1920, 1080]]);
    expect(mapping.unresolved).toEqual([]);
    for (const s of PIXEL_TEST_LAYOUT) {
      const r = mapping.screens.find((m) => m.name === s.name)!;
      expect([r.masterRect.x, r.masterRect.y, r.outputRect.x, r.outputRect.y]).toEqual([...s.master, ...s.output]);
      for (const n of [...s.master, ...s.output]) expect(n % 2).toBe(1);
    }
    expect(mapping.screens.map((s) => [s.masterRect.width, s.masterRect.height])).toEqual([[768, 512], [768, 384], [1008, 168]]);
  });

  it("the output target copies each grid rectangle 1:1, so the grid's edge pixels land on each slice's edges", () => {
    const out = videoTargets(mapping).find((t) => t.kind === "output")!;
    expect(out.problem).toBeNull();
    for (const s of mapping.screens) {
      expect(out.regions).toContainEqual({ from: { x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height }, to: { x: s.outputRect.x, y: s.outputRect.y } });
    }
    expect(videoTargets(mapping).find((t) => t.kind === "master")!.problem).toBeNull();
  });
});
