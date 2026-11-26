import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { Project } from "@/domain/model";
import { MASK_MODULE_ID, MASK_VERSION, parseMask, parsePointsText, parseSvgMask, rasterizeMask, screenMasks, setCanvasMask, EMPTY_MASK } from "@/engines/content/mask";
import { addScene, EMPTY_SCENES, parseScenes, SCENES_MODULE_ID, SCENES_VERSION, setActiveScene, setStagePose, type ScenesData } from "@/engines/content/scenes";
import { resolveMapping } from "@/engines/mapping";
import { applyStagePoses, previewRegions } from "@/engines/motion/regions";
import { diagonalBandAt, diagonalColorAt, renderPattern, DIAGONAL_DEFAULTS, DIAGONAL_TRAVEL_S } from "@/engines/motion/patterns";
import { setModuleData } from "@/engines/project-ops";
import { validateProject } from "@/engines/validation";
import { videoTargets } from "@/engines/video-targets";
import { buildResolumeSetup, buildSlicesCsv } from "@/exports/resolume/adapter";
import { buildResolumePackage } from "@/exports/resolume/package";
import { parseProjectFile, serializeProject } from "@/persistence/schema";
import type { FrameInput, FrameSource } from "@/preview/contract";
import { composeScene, maskSource } from "@/preview/scene-source";
import { patternSource, readMask, readScenes, sceneSource, withMask } from "@/modules/content/scene-sources";
import { threeScreenProject } from "./helpers";
import { targetSource } from "@/modules/output/target-source";
import { buildViewModel } from "@/state/view-model";
import { installSoftCanvas, softContext } from "./soft-canvas";

const pilot = (): Project => parseProjectFile(readFileSync(new URL("./fixtures/puebla-d01.pixellab.json", import.meta.url), "utf8"));
const D01 = { x: 8568, y: 840, width: 672, height: 1344 };
const OPTS = { scale: 1, fontFamily: "Arial" };

/** Solid 1 px stripes in both directions, so every pixel's colour depends on where it is drawn. */
function stripes(id: string, salt: number): FrameSource {
  return {
    id,
    name: id,
    draw(ctx, input) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (let x = 0; x < input.width; x++) {
        ctx.fillStyle = `rgb(${(x * 7 + salt) % 256},${(x >> 8) % 256},${(salt * 3 + input.frame) % 256})`;
        ctx.fillRect(x, 0, 1, input.height);
      }
      for (let y = 0; y < input.height; y += 7) {
        ctx.fillStyle = `rgb(${(y + salt) % 256},${(y * 3) % 256},${(y >> 4) % 256})`;
        ctx.fillRect(0, y, input.width, 1);
      }
    },
  };
}

function master(project: Project): Omit<FrameInput, "frame" | "fps"> {
  const mapping = resolveMapping(project);
  return {
    width: mapping.master.width,
    height: mapping.master.height,
    screens: mapping.screens.map((s) => ({ id: s.screenId, name: s.name, x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height })),
  };
}

function render(source: FrameSource, input: Omit<FrameInput, "frame" | "fps">, frame = 0) {
  const ctx = softContext(input.width, input.height);
  source.draw(ctx, { ...input, frame, fps: 30 }, OPTS);
  return ctx.canvas as unknown as { width: number; height: number; data: Uint8ClampedArray };
}

/** Every call and property set a source makes, in order. */
function record(source: FrameSource, input: FrameInput): unknown[][] {
  const calls: unknown[][] = [];
  const gradient = { addColorStop: (...a: unknown[]) => calls.push(["addColorStop", ...a]) };
  const ctx = new Proxy({}, {
    get: (_, k) => (...a: unknown[]) => (calls.push([k, ...a]), k === "createLinearGradient" || k === "createRadialGradient" ? gradient : undefined),
    set: (_, k, v) => (calls.push(["set", k, v === gradient ? "gradient" : v]), true),
  });
  source.draw(ctx as CanvasRenderingContext2D, input, OPTS);
  return calls;
}

const inside = (r: typeof D01, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

function doorScenes(): ScenesData {
  let s = addScene(EMPTY_SCENES, { id: "panorama", name: "Panorama", base: "diagonal", overrides: [] });
  s = addScene(s, { id: "door", name: "Puerta", base: "diagonal", overrides: [{ screenId: "D01", sourceId: "source:calibration-test-card" }] });
  return setActiveScene(s, "door");
}

beforeAll(installSoftCanvas);

describe("Puebla D01 pilot", () => {
  it("is the map the acceptance tests describe", () => {
    const m = resolveMapping(pilot());
    const d = m.screens.find((s) => s.screenId === "D01")!;
    expect([d.masterRect.x, d.masterRect.y, d.masterRect.width, d.masterRect.height]).toEqual([8568, 840, 672, 1344]);
    expect(m.screens.find((s) => s.screenId === "CR")!.masterRect.x).toBe(9240);
  });
});

describe("1. Panorama: the diagonal crosses D01's edges without a step", () => {
  it("composeScene without overrides is the base itself, so the master is identical pixel for pixel", () => {
    const base = stripes("base", 11);
    expect(composeScene(base, [])).toBe(base);
    // The panorama scene draws exactly what the Diagonal pattern draws: the same calls, in order.
    const input = { ...master(pilot()), frame: 37, fps: 30 as const };
    const fromScene = sceneSource(setActiveScene(doorScenes(), "panorama"), { findSource: () => null })!;
    expect(record(fromScene, input)).toEqual(record(patternSource("diagonal"), input));
    expect(record(fromScene, input).some((c) => c[0] === "createLinearGradient")).toBe(true);
  });

  it.each([0, 90])("frame %i: one straight line through x 8568 and x 9240, at most 1 px off", (frame) => {
    const input = { ...master(pilot()), frame, fps: 30 as const };
    const g = { a: (DIAGONAL_DEFAULTS.angle * Math.PI) / 180 };
    for (const edge of [8568, 9240]) {
      for (let y = D01.y; y < D01.y + D01.height; y += 97) {
        // The band boundary nearest the edge on this row, found from the pixels on both sides of it.
        const left = diagonalBandAt(edge - 1, y, input), right = diagonalBandAt(edge, y, input);
        const leftFar = diagonalBandAt(edge - 2, y, input), rightFar = diagonalBandAt(edge + 1, y, input);
        // Bands are much wider than 2 px: across the edge the colour changes at most once.
        expect([left !== leftFar, left !== right, right !== rightFar].filter(Boolean).length).toBeLessThanOrEqual(1);
        // And the boundary lies on the global line x·cos + y·sin = shift + k·band.
        if (left !== right) {
          const period = Math.max(64, Math.round(Math.min(input.width, input.height) / 2));
          const shift = (((frame / 30 / DIAGONAL_TRAVEL_S) * period) % period + period) % period;
          const d = (edge * Math.cos(g.a) + y * Math.sin(g.a) - shift) / (period / 4);
          expect(Math.abs(d - Math.round(d)) * (period / 4) / Math.cos(g.a)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("the gradient the preview draws gives the same band as diagonalBandAt, on both sides of each edge", () => {
    const input = { ...master(pilot()), frame: 90, fps: 30 as const };
    const p = renderPattern("diagonal", input).primitives[0];
    if (p.kind !== "linear") throw new Error("expected one linear gradient");
    const [fx, fy] = p.from, [tx, ty] = p.to;
    const len2 = (tx - fx) ** 2 + (ty - fy) ** 2;
    for (const x of [8566, 8567, 8568, 8569, 9238, 9239, 9240, 9241]) {
      for (let y = 840; y < 2184; y += 131) {
        const t = ((x + 0.5 - fx) * (tx - fx) + (y + 0.5 - fy) * (ty - fy)) / len2;
        const stop = p.stops.findIndex(([o], i) => i % 2 === 1 && o > t);
        expect(p.stops[stop][1]).toBe(diagonalColorAt(x + 0.5, y + 0.5, input));
      }
    }
  });
});

describe("2. Door: D01 plays its own source, everything else is the panorama", () => {
  it("outside D01's master rectangle every pixel is panorama; inside, D01's source at 672 × 1344", () => {
    const m = master(pilot());
    const base = stripes("base", 11);
    const door = stripes("door", 101);
    const panorama = render(base, m);
    const scene = render(composeScene(base, [{ screenId: "D01", source: door }]), m);
    const alone = render(door, { width: 672, height: 1344, screens: [{ id: "D01", name: "D01", x: 0, y: 0, width: 672, height: 1344 }] });
    let checked = 0;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const o = (y * m.width + x) * 4;
        const want = inside(D01, x, y) ? alone.data.subarray(((y - D01.y) * 672 + x - D01.x) * 4, ((y - D01.y) * 672 + x - D01.x) * 4 + 3) : panorama.data.subarray(o, o + 3);
        if (scene.data[o] !== want[0] || scene.data[o + 1] !== want[1] || scene.data[o + 2] !== want[2]) throw new Error(`pixel ${x}, ${y}`);
        checked++;
      }
    }
    expect(checked).toBe(m.width * m.height);
  });
});

describe("3. The map doesn't change with any scene, pose or mask", () => {
  it("resolveMapping, the slices CSV and every Resolume file but the embedded project are byte for byte the same", async () => {
    const plain = pilot();
    let dressed = setModuleData(plain, SCENES_MODULE_ID, SCENES_VERSION, setStagePose(doorScenes(), "D01", "open"));
    dressed = setModuleData(dressed, MASK_MODULE_ID, MASK_VERSION, setCanvasMask(EMPTY_MASK, "pan", { enabled: true, polygons: [[0, 2184, 0, 336, 8904, 0, 17808, 336, 17808, 2184]] }));
    const a = resolveMapping(plain), b = resolveMapping(dressed);
    expect(b).toEqual(a);
    expect(buildSlicesCsv(buildResolumeSetup(b))).toBe(buildSlicesCsv(buildResolumeSetup(a)));
    // The pilot's 17808 px virtual output is over the export gate's limit, so the package is checked on a
    // project the gate accepts, dressed with the same scene, open pose and mask.
    const small = threeScreenProject().project;
    const id = small.physical.screens[1].id;
    let smallDressed = setModuleData(small, SCENES_MODULE_ID, SCENES_VERSION, setStagePose(setActiveScene(addScene(EMPTY_SCENES, { id: "door", name: "Door", base: "diagonal", overrides: [{ screenId: id, sourceId: "source:calibration-test-card" }] }), "door"), id, "open"));
    smallDressed = setModuleData(smallDressed, MASK_MODULE_ID, MASK_VERSION, setCanvasMask(EMPTY_MASK, small.content.canvases[0].id, { enabled: true, polygons: [[0, 0, 900, 0, 0, 700]] }));
    const sa = resolveMapping(small), sb = resolveMapping(smallDressed);
    expect(sb).toEqual(sa);
    const png = async () => new Blob(["png"]);
    const pa = await buildResolumePackage(small, sa, validateProject(small, sa), "2026-11-26T00:00:00.000Z", png);
    const pb = await buildResolumePackage(smallDressed, sb, validateProject(smallDressed, sb), "2026-11-26T00:00:00.000Z", png);
    const bytes = async (f: { content: string | Blob }) => (f.content instanceof Blob ? new Uint8Array(await f.content.arrayBuffer()) : new TextEncoder().encode(f.content));
    expect(pb.files.map((f) => f.path)).toEqual(pa.files.map((f) => f.path));
    for (let i = 0; i < pa.files.length; i++) {
      if (pa.files[i].path.startsWith("project/")) continue;
      const [x, y] = [await bytes(pb.files[i]), await bytes(pa.files[i])];
      expect(x.length, pa.files[i].path).toBeGreaterThan(0);
      expect(Buffer.compare(Buffer.from(x), Buffer.from(y)), pa.files[i].path).toBe(0);
    }
    // The embedded project copy differs only by its module data.
    const project = (p: typeof pa) => JSON.parse(p.files.find((f) => f.path.startsWith("project/"))!.content as string).project;
    expect({ ...project(pb), modules: {} }).toEqual({ ...project(pa), modules: {} });
  });
});

describe("4. Door open on the Physical view", () => {
  it("D01 leaves its stage rectangle; its slice and master rectangle stay the same", () => {
    const project = pilot();
    const mapping = resolveMapping(project);
    const regions = previewRegions(buildViewModel(project, mapping, "physical", null).items, mapping);
    const { regions: shown, openings } = applyStagePoses(regions, { D01: "open" });
    expect(shown.map((r) => r.screenId)).not.toContain("D01");
    expect(shown).toHaveLength(regions.length - 1);
    const d = mapping.screens.find((s) => s.screenId === "D01")!;
    expect(openings).toEqual([{ screenId: "D01", name: d.name, rect: regions.find((r) => r.screenId === "D01")!.dest }]);
    expect(openings[0].rect).toEqual(d.stage);
    const opened = setModuleData(project, SCENES_MODULE_ID, SCENES_VERSION, setStagePose(EMPTY_SCENES, "D01", "open"));
    const after = resolveMapping(opened).screens.find((s) => s.screenId === "D01")!;
    expect([after.masterRect, after.outputRect, after.stage]).toEqual([d.masterRect, d.outputRect, d.stage]);
    expect(applyStagePoses(regions, { D01: "closed" }).regions).toEqual(regions);
  });
});

describe("5. Per-screen MP4 target over composeScene", () => {
  it.each([0, 90])("D01's file in the door scene, frame %i, is D01's source", (frame) => {
    const project = pilot();
    const mapping = resolveMapping(project);
    const m = master(project);
    const door = stripes("door", 101);
    const target = videoTargets(mapping).find((t) => t.id === "screen:D01")!;
    expect([target.width, target.height]).toEqual([672, 1344]);
    const file = render(targetSource(composeScene(stripes("base", 11), [{ screenId: "D01", source: door }]), target, m), { ...m, width: 672, height: 1344 }, frame);
    const alone = render(door, { width: 672, height: 1344, screens: [{ id: "D01", name: "D01", x: 0, y: 0, width: 672, height: 1344 }] }, frame);
    expect(Buffer.compare(Buffer.from(file.data), Buffer.from(alone.data))).toBe(0);
  });
});

describe("6. Format: scenes and poses are saved and reopened", () => {
  it("round-trips through the project file; a project without them opens as today", () => {
    const scenes = setStagePose(doorScenes(), "D01", "open");
    const saved = setModuleData(pilot(), SCENES_MODULE_ID, SCENES_VERSION, scenes);
    const reopened = parseProjectFile(serializeProject(saved));
    expect(readScenes(reopened)).toEqual(scenes);
    expect(readScenes(pilot())).toEqual(EMPTY_SCENES);
    expect(readMask(pilot())).toEqual(EMPTY_MASK);
    expect(pilot().modules).toEqual({});
  });

  it("refuses anything unexpected instead of guessing", () => {
    expect(parseScenes({ active: null, scenes: [], stagePoses: {} }, 2)).toBeNull();
    expect(parseScenes({ active: "x", scenes: [], stagePoses: {} }, 1)).toBeNull();
    expect(parseScenes({ active: null, scenes: [], stagePoses: { D01: "ajar" } }, 1)).toBeNull();
    expect(parseScenes({ active: null, scenes: [], stagePoses: {}, extra: 1 }, 1)).toBeNull();
    const dup = { id: "a", name: "A", base: "flow", overrides: [{ screenId: "D01", sourceId: "flow" }, { screenId: "D01", sourceId: "grid" }] };
    expect(parseScenes({ active: null, scenes: [dup], stagePoses: {} }, 1)).toBeNull();
  });
});

describe("Content mask", () => {
  // A toothed top edge, like the Puebla silhouette, over the whole panorama canvas.
  const teeth = (): number[] => {
    const pts = [0, 2184, 0, 336];
    for (let x = 0; x < 17808; x += 672) pts.push(x + 336, 0, Math.min(17808, x + 672), 336);
    pts.push(17808, 2184);
    return pts;
  };
  const masked = (enabled: boolean) => setModuleData(pilot(), MASK_MODULE_ID, MASK_VERSION, setCanvasMask(EMPTY_MASK, "pan", { enabled, polygons: [teeth(), [8700, 1000, 9100, 1000, 9100, 2000]] }));

  it("leaves every pixel inside unchanged and blacks out every pixel outside, exactly, at scale 1", () => {
    const project = masked(true);
    const mapping = resolveMapping(project);
    const m = master(project);
    const base = stripes("base", 11);
    const plain = render(base, m);
    const out = render(withMask(base, mapping, readMask(project)), m);
    const masks = screenMasks(mapping, readMask(project));
    expect(masks.map((s) => s.screenId).sort()).toEqual(["CH", "CL", "CR", "D01", "L", "R"]);
    const bits = new Uint8Array(m.width * m.height);
    for (const s of masks) {
      const b = rasterizeMask(s);
      for (let y = 0; y < s.rect.height; y++) for (let x = 0; x < s.rect.width; x++) bits[(s.rect.y + y) * m.width + s.rect.x + x] = b[y * s.rect.width + x] ? 1 : 2;
    }
    let ins = 0, outs = 0;
    for (let i = 0; i < bits.length; i++) {
      const o = i * 4;
      if (bits[i] === 2) {
        if (out.data[o] || out.data[o + 1] || out.data[o + 2]) throw new Error(`outside pixel ${i % m.width}, ${Math.floor(i / m.width)} isn't black`);
        outs++;
      } else {
        if (out.data[o] !== plain.data[o] || out.data[o + 1] !== plain.data[o + 1] || out.data[o + 2] !== plain.data[o + 2]) throw new Error(`pixel ${i % m.width}, ${Math.floor(i / m.width)} changed`);
        ins++;
      }
    }
    expect(ins).toBeGreaterThan(0);
    expect(outs).toBeGreaterThan(0);
  });

  it("follows the pixel-centre rule on a small shape", () => {
    const bits = rasterizeMask({ screenId: "s", rect: { x: 0, y: 0, width: 4, height: 4 }, polygons: [[1, 1, 3, 1, 3, 3, 1, 3]], bitmap: null });
    expect(Array.from(bits)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    const tri = rasterizeMask({ screenId: "s", rect: { x: 10, y: 10, width: 3, height: 3 }, polygons: [[10, 10, 13, 10, 10, 13]], bitmap: null });
    // Centres on the hypotenuse x + y = 3 are outside: [a, b) spans, so edges are never counted twice.
    expect(Array.from(tri)).toEqual([1, 1, 0, 1, 0, 0, 0, 0, 0]);
  });

  it("with the mask off, the export source is the same source, so the file is byte-identical", () => {
    const project = masked(false);
    const mapping = resolveMapping(project);
    const base = stripes("base", 11);
    expect(withMask(base, mapping, readMask(project))).toBe(base);
    expect(maskSource(base, [])).toBe(base);
    expect(withMask(base, mapping, readMask(pilot()))).toBe(base);
  });

  it("reads straight-line SVG shapes and point lists, and refuses curves and transforms with a reason", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="0,0 10,0 10,10"/><rect x="20" y="20" width="5" height="5"/><path d="M30 30 h10 v10 z m 5 5 l1 0 l0 1 Z"/></svg>`;
    expect(parseSvgMask(svg)).toEqual([[0, 0, 10, 0, 10, 10], [20, 20, 25, 20, 25, 25, 20, 25], [30, 30, 40, 30, 40, 40], [35, 35, 36, 35, 36, 36]]);
    expect(() => parseSvgMask(`<svg><path d="M0 0 C 1 1 2 2 3 3 Z"/></svg>`)).toThrow(/straight lines only/);
    expect(() => parseSvgMask(`<svg><g transform="scale(2)"><polygon points="0,0 1,0 1,1"/></g></svg>`)).toThrow(/transforms/);
    expect(parsePointsText("0,0 10,0 10,10\n\n5,5 6,5 6,6")).toEqual([[0, 0, 10, 0, 10, 10], [5, 5, 6, 5, 6, 6]]);
    expect(() => parsePointsText("0,0 1,1")).toThrow(/three/);
    expect(parseMask({ canvases: { pan: { enabled: true, polygons: [[0, 0, 1, 0]] } } }, 1)).toBeNull();
    expect(parseMask({ canvases: { pan: { enabled: true, polygons: [[0, 0, 1, 0, 1, 1]] } } }, 1)).not.toBeNull();
  });
});
