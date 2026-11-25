import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BUILTIN_CABINETS } from "@/domain/cabinets";
import type { CabinetProfile, Project } from "@/domain/model";
import { mmToUm, px } from "@/domain/units";
import { resolveMapping, type ResolvedMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { validateProject } from "@/engines/validation";
import { corporateKeynote } from "@/examples/keynote";
import type { ExportFile } from "@/exports/contract";
import { masterScene, outputScene, screenScene, type PixelMapScene, type SceneNode } from "@/exports/scene";
import { renderSvg } from "@/exports/svg";
import { allTemplates, canvasTemplate, contentTemplatesExport, outputTemplate, SAFE_AREAS, screenTemplate } from "@/exports/templates/templates";
import { festivalMainStage, testContext, threeScreenProject } from "./helpers";

const P39 = BUILTIN_CABINETS.find((c) => c.id === "builtin-500x500-p391")!;
const P26 = BUILTIN_CABINETS.find((c) => c.id === "builtin-500x500-p26")!;
const TALL: CabinetProfile = { ...P39, id: "tall-p39", name: "500×1000 P3.91", heightUm: mmToUm(1000), pixelsY: px(256), source: "custom" };

/** The HP Stage demo's screens, at their sizes, laid out in one 1920 × 1080 output. */
function hpStage(): Project {
  const ctx = testContext();
  let p = [P39, P26, TALL].reduce((acc, c) => ops.addCabinet(acc, c), ops.createProject({ name: "HP Stage" }, ctx));
  const screens: [string, CabinetProfile, number, number, number, number][] = [
    ["Header", P39, 8, 1, 416, 0],
    ["Torre izq", P39, 2, 6, 0, 160],
    ["Cuchilla izq", TALL, 1, 2, 288, 288],
    ["Centro", P26, 5, 3, 448, 256],
    ["Cuchilla der", TALL, 1, 2, 1440, 288],
    ["Torre der", P39, 2, 6, 1600, 160],
    ["DJ", P39, 4, 1, 672, 960],
    ["Cinta", P39, 14, 1, 32, 1120],
  ];
  for (const [name, cabinet, columns, rows] of screens) p = ops.addScreen(p, { name, cabinetId: cabinet.id, columns, rows }, ctx);
  p.physical.screens.forEach((s, i) => (p = ops.setRegionPosition(p, s.id, px(screens[i][4]), px(screens[i][5]))));
  return p;
}

const FIXTURES: [string, ResolvedMapping][] = [
  ["Festival Main Stage", resolveMapping(festivalMainStage())],
  ["HP Stage", resolveMapping(hpStage())],
  ["Corporate Keynote", resolveMapping(corporateKeynote())],
  ["three screens", resolveMapping(threeScreenProject().project)],
];
const festival = FIXTURES[0][1];
const fakePng = async (scene: PixelMapScene) => new Blob([`${scene.width}x${scene.height}`]);
const input = (mapping: ResolvedMapping, project: Project = festivalMainStage()) => ({ project, mapping, issues: [], generatedAt: "2026-11-25T00:00:00.000Z", rasterize: fakePng });
const rects = (scene: PixelMapScene, fill: string) => scene.nodes.filter((n): n is Extract<SceneNode, { kind: "rect" }> => n.kind === "rect" && n.fill === fill);

describe("content templates: sizes", () => {
  for (const [name, mapping] of FIXTURES) {
    it(`${name}: every template is the exact size from the mapping`, () => {
      for (const s of mapping.screens) expect([screenTemplate(s).width, screenTemplate(s).height]).toEqual([s.spec.pixelWidth, s.spec.pixelHeight]);
      for (const o of mapping.outputs) {
        const t = outputTemplate(mapping, o.outputId);
        if (o.screenIds.length) expect([t!.width, t!.height]).toEqual([o.width, o.height]);
        else expect(t).toBeNull();
      }
      for (const c of mapping.canvases) {
        const screens = mapping.screens.filter((s) => s.canvasId === c.canvasId);
        const t = canvasTemplate(mapping, c.canvasId)!;
        expect([t.width, t.height]).toEqual([Math.max(...screens.map((s) => s.canvasRect.x + s.canvasRect.width)), Math.max(...screens.map((s) => s.canvasRect.y + s.canvasRect.height))]);
      }
    });

    it(`${name}: whole pixels only, and nothing outside the template`, () => {
      for (const { scene } of allTemplates(mapping)) {
        for (const n of scene.nodes) {
          if (n.kind !== "rect") continue;
          expect([n.x, n.y, n.width, n.height].every(Number.isInteger)).toBe(true);
          expect(n.x >= 0 && n.y >= 0 && n.x + n.width <= scene.width && n.y + n.height <= scene.height && n.width > 0 && n.height > 0).toBe(true);
        }
      }
    });
  }

  it("HP Stage: the sizes a designer needs", () => {
    const hp = FIXTURES[1][1];
    const size = (name: string) => {
      const t = screenTemplate(hp.screens.find((s) => s.name === name)!);
      return `${t.width}x${t.height}`;
    };
    expect(["Header", "Torre izq", "Cuchilla izq", "Centro", "DJ", "Cinta"].map(size)).toEqual(["1024x128", "256x768", "128x512", "960x576", "512x128", "1792x128"]);
  });

  it("Festival Main Stage: screens, the two canvases and the two processor outputs", () => {
    const paths = allTemplates(festival).map((t) => t.path);
    expect(paths).toEqual([
      "screens/center-wall_3072x1536", "screens/imag-left_768x1280", "screens/imag-right_768x1280", "screens/header_3072x384", "screens/ribbon_4608x128", "screens/dj-booth_512x256",
      "canvases/main-canvas_4608x1664", "canvases/dj-booth-canvas_512x256",
      "outputs/processor-a_3072x1920", "outputs/processor-b_4608x1408",
    ]);
  });
});

describe("content templates: what they show", () => {
  it("draws the cabinet grid on exact cabinet boundaries, and nowhere else", () => {
    for (const [, mapping] of FIXTURES) {
      for (const s of mapping.screens) {
        const t = screenTemplate(s);
        const grid = rects(t, "#3A3E50");
        const [w, h] = [s.cabinet.pixelsX, s.cabinet.pixelsY];
        expect(grid.filter((r) => r.width === 1).map((r) => r.x)).toEqual(Array.from({ length: s.columns - 1 }, (_, i) => (i + 1) * w));
        expect(grid.filter((r) => r.height === 1 && r.width !== 1).map((r) => r.y)).toEqual(Array.from({ length: s.rows - 1 }, (_, i) => (i + 1) * h));
      }
    }
  });

  it("marks each screen's edge on its outermost pixels, in its own coordinates, in every template it's in", () => {
    for (const [, mapping] of FIXTURES) {
      for (const o of mapping.outputs) {
        const t = outputTemplate(mapping, o.outputId);
        for (const s of mapping.screens.filter((q) => q.outputId === o.outputId)) {
          const { x, y, width, height } = s.outputRect;
          expect(rects(t!, s.color)).toEqual(expect.arrayContaining([
            { kind: "rect", x, y, width, height: 1, fill: s.color },
            { kind: "rect", x: x + width - 1, y, width: 1, height, fill: s.color },
            { kind: "rect", x, y: y + height - 1, width, height: 1, fill: s.color },
          ]));
        }
      }
    }
  });

  it("puts both safe areas inside the screen, the title-safe one inside the action-safe one", () => {
    for (const s of festival.screens) {
      const t = screenTemplate(s);
      const [action, title] = SAFE_AREAS.map((safe) => rects(t, safe.color));
      const box = (r: typeof action) => ({ x: Math.min(...r.map((q) => q.x)), y: Math.min(...r.map((q) => q.y)), right: Math.max(...r.map((q) => q.x + q.width)), bottom: Math.max(...r.map((q) => q.y + q.height)) });
      const [a, b] = [box(action), box(title)];
      expect(a).toEqual({ x: Math.round(t.width * 0.05), y: Math.round(t.height * 0.05), right: t.width - Math.round(t.width * 0.05), bottom: t.height - Math.round(t.height * 0.05) });
      expect(b.x > a.x && b.y > a.y && b.right < a.right && b.bottom < a.bottom).toBe(true);
    }
  });

  it("names the screen, its resolution, position and cabinets", () => {
    const s = festival.screens[0];
    const text = screenTemplate(s).nodes.flatMap((n) => (n.kind === "text" ? [n.text] : []));
    expect(text).toEqual(["Center Wall", "3072 × 1536 px", "master 768, 0", "16 × 8 cabinets of 192 × 192 px"]);
    const output = outputTemplate(festival, s.outputId)!.nodes.flatMap((n) => (n.kind === "text" ? [n.text] : []));
    expect(output).toContain(`output ${s.outputRect.x}, ${s.outputRect.y}`);
  });

  it("pixels outside every screen stay black", () => {
    const t = outputTemplate(festival, festival.outputs[0].outputId)!;
    expect(t.nodes[0]).toEqual({ kind: "rect", x: 0, y: 0, width: t.width, height: t.height, fill: "#000000" });
  });
});

describe("content templates: files", () => {
  it("an SVG and a PNG for every template, with unique names", async () => {
    const files = await contentTemplatesExport.build(input(festival));
    const paths = files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((p) => p.endsWith(".svg"))).toHaveLength(10);
    expect(paths.filter((p) => p.endsWith(".png"))).toHaveLength(10);
  });

  it("two screens with one name still get two files", () => {
    const ctx = testContext();
    let p = ops.addCabinet(ops.createProject({ name: "Twins" }, ctx), P39);
    p = ops.addScreen(ops.addScreen(p, { name: "Side", cabinetId: P39.id, columns: 2, rows: 2 }, ctx), { name: "Side", cabinetId: P39.id, columns: 2, rows: 2 }, ctx);
    expect(allTemplates(resolveMapping(p)).filter((t) => t.path.startsWith("screens/")).map((t) => t.path)).toEqual(["screens/side_256x256", "screens/side_256x256-2"]);
  });

  it("the same project gives the same bytes", async () => {
    const text = async (files: readonly ExportFile[]) => Promise.all(files.map(async (f) => `${f.path}\n${typeof f.content === "string" ? f.content : await f.content.text()}`));
    const a = await text(await contentTemplatesExport.build(input(festival)));
    const b = await text(await contentTemplatesExport.build(input(resolveMapping(festivalMainStage()))));
    expect(b).toEqual(a);
    const svg = renderSvg(screenTemplate(festival.screens[0]));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="3072" height="1536" viewBox="0 0 3072 1536"')).toBe(true);
  });

  it("works while the mapping has errors, since no processor reads it", async () => {
    const { project, ids } = threeScreenProject();
    const overlapping = ops.setRegionPosition(project, ids.right, px(0), px(0));
    const mapping = resolveMapping(overlapping);
    expect(validateProject(overlapping, mapping).some((i) => i.severity === "error")).toBe(true);
    expect(contentTemplatesExport.requiresValidMapping).toBe(false);
    expect((await contentTemplatesExport.build({ ...input(mapping, overlapping), issues: validateProject(overlapping, mapping) })).length).toBeGreaterThan(0);
  });

  it("says so when there's nothing to make", async () => {
    const empty = ops.createProject({ name: "Empty" }, testContext());
    await expect(contentTemplatesExport.build(input(resolveMapping(empty), empty))).rejects.toThrow("There are no screens");
  });

  it("leaves the existing pixel maps exactly as they were", () => {
    // SHA-256 of today's Festival Main Stage pixel maps, taken on main before templates existed.
    const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
    allTemplates(festival);
    expect([renderSvg(masterScene(festival, "m")), renderSvg(outputScene(festival, festival.outputs[0].outputId, "o")), renderSvg(screenScene(festival.screens[0]))].map(sha)).toEqual(["82791d77d4fe3e7c", "7bf7696432c65d63", "371bf1119017f400"]);
  });
});
