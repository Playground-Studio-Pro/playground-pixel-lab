import { describe, expect, it } from "vitest";
import { px } from "@/domain/units";
import { assertExportable, ExportBlockedError, slugify } from "@/exports/gate";
import { buildManifest } from "@/exports/manifest";
import { readPngSize } from "@/exports/png";
import { buildReport } from "@/exports/report";
import { buildResolumeGuide, buildResolumeSetup, buildSlicesCsv, halfPixelSlices, nativePresetSupport } from "@/exports/resolume/adapter";
import { buildResolumePackage } from "@/exports/resolume/package";
import { masterScene, outputScene, screenScene, SCENE_BORDER } from "@/exports/scene";
import { escapeXml, renderSvg } from "@/exports/svg";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { validateProject } from "@/engines/validation";
import { parseProjectFile } from "@/persistence/schema";
import { pixelTestProject } from "./fixtures/pixel-test";
import { threeScreenProject } from "./helpers";

const NOW = "2026-11-07T12:00:00.000Z";

function setup() {
  const { project, ids } = threeScreenProject();
  const mapping = resolveMapping(project);
  return { project, ids, mapping, issues: validateProject(project, mapping) };
}

describe("pixel map scene", () => {
  it("matches the master size exactly", () => {
    const scene = masterScene(setup().mapping, "t");
    expect([scene.width, scene.height]).toEqual([2432, 768]);
    expect(scene.nodes[0]).toMatchObject({ kind: "rect", x: 0, y: 0, width: 2432, height: 768 });
  });

  it("uses whole numbers for every rectangle", () => {
    for (const node of masterScene(setup().mapping, "t").nodes) {
      if (node.kind === "rect") {
        for (const v of [node.x, node.y, node.width, node.height]) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it("draws one cell per cabinet that tiles the screen exactly", () => {
    const { mapping } = setup();
    const scene = screenScene(mapping.screens[0]);
    const cells = scene.nodes.filter((n) => n.kind === "rect" && n.width === 128 && n.height === 128);
    expect(cells).toHaveLength(24);
  });

  it("draws the border on the screen's outermost pixels", () => {
    const { mapping } = setup();
    const center = mapping.screens[1].masterRect;
    const rects = masterScene(mapping, "t").nodes.filter((n) => n.kind === "rect" && n.fill === SCENE_BORDER);
    expect(rects).toContainEqual({ kind: "rect", x: center.x, y: center.y, width: 1, height: center.height, fill: SCENE_BORDER });
    expect(rects).toContainEqual({ kind: "rect", x: center.x + center.width - 1, y: center.y, width: 1, height: center.height, fill: SCENE_BORDER });
  });

  it("uses output coordinates in an output map", () => {
    const { project, ids } = setup();
    const moved = ops.setSlicePositions(project, [{ id: ids.left, x: px(3000), y: px(0) }]);
    const scene = outputScene(resolveMapping(moved), moved.output.outputs[0].id, "o");
    expect(scene.width).toBe(3512);
    expect(scene.nodes.some((n) => n.kind === "rect" && n.x === 3000 && n.width === 1)).toBe(true);
  });
});

describe("renderSvg", () => {
  it("has identical width, height and viewBox", () => {
    const svg = renderSvg(masterScene(setup().mapping, "t"));
    expect(svg).toContain('width="2432" height="768" viewBox="0 0 2432 768"');
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it("escapes names", () => {
    expect(escapeXml(`A&B <"'>`)).toBe("A&amp;B &lt;&quot;&apos;&gt;");
    const { project, ids } = setup();
    const renamed = ops.updateScreen(project, ids.left, { name: "<script>" });
    expect(renderSvg(masterScene(resolveMapping(renamed), "t"))).not.toContain("<script>");
  });

  it("is deterministic", () => {
    const { mapping } = setup();
    expect(renderSvg(masterScene(mapping, "t"))).toBe(renderSvg(masterScene(mapping, "t")));
  });
});

describe("readPngSize", () => {
  it("reads dimensions from the header", () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(bytes.buffer).setUint32(16, 2432);
    new DataView(bytes.buffer).setUint32(20, 768);
    expect(readPngSize(bytes)).toEqual({ width: 2432, height: 768 });
  });
  it("rejects non-PNG data", () => {
    expect(readPngSize(new Uint8Array(24))).toBeNull();
  });
});

describe("manifest", () => {
  it("states units and exact coordinates", () => {
    const { project, mapping, issues } = setup();
    const manifest = buildManifest(project, mapping, issues, NOW);
    expect(manifest.masterCanvas).toMatchObject({ width: 2432, height: 768 });
    expect(manifest.coordinateSystem.origin).toBe("top-left");
    expect(manifest.screens[2]).toMatchObject({
      name: "Right",
      columns: 3,
      rows: 5,
      resolution: { width: 384, height: 640 },
      physical: { widthMm: "1500", heightMm: "2500" },
      content: { masterRect: { x: 2048, y: 0, width: 384, height: 640 } },
      output: { rect: { x: 2048, y: 0, width: 384, height: 640 }, followsContent: true },
    });
  });
  it("survives JSON unchanged", () => {
    const { project, mapping, issues } = setup();
    const manifest = buildManifest(project, mapping, issues, NOW);
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});

describe("report", () => {
  it("lists totals and coordinates", () => {
    const { project, mapping, issues } = setup();
    const report = buildReport(project, mapping, issues, NOW);
    expect(report).toContain("2432 × 768 px");
    expect(report).toContain("| Center | Main canvas | 512 | 0 | 1536 | 768 |");
    expect(report).toContain("| Cabinets | 111 |");
  });
  it("keeps table structure when a name contains a pipe", () => {
    const { project, ids } = setup();
    const renamed = ops.updateScreen(project, ids.left, { name: "A|B" });
    const mapping = resolveMapping(renamed);
    expect(buildReport(renamed, mapping, [], NOW)).toContain("A\\|B");
  });
});

describe("Resolume adapter", () => {
  it("does not claim native preset support", () => {
    expect(nativePresetSupport.status).toBe("unsupported");
  });

  it("gives every slice input and output of equal size", () => {
    const { mapping } = setup();
    const resolume = buildResolumeSetup(mapping);
    expect(resolume.composition).toEqual({ width: 2432, height: 768 });
    for (const slice of resolume.screens.flatMap((s) => s.slices)) {
      expect(slice.input.width).toBe(slice.output.width);
      expect(slice.input.height).toBe(slice.output.height);
    }
  });

  it("omits outputs with no screens", () => {
    const { project } = setup();
    const { project: two } = ops.addOutput(project, "Spare", { newId: () => "spare", now: () => NOW });
    expect(buildResolumeSetup(resolveMapping(two)).screens.map((s) => s.name)).toEqual(["Output 1"]);
  });

  it("writes a parsable CSV", () => {
    const csv = buildSlicesCsv(buildResolumeSetup(setup().mapping)).trim().split("\r\n");
    expect(csv).toHaveLength(4);
    expect(csv[0]).toBe("resolume_screen,slice,input_center_x,input_center_y,input_w,input_h,output_center_x,output_center_y,output_w,output_h,input_left,input_top,output_left,output_top");
    expect(csv[2]).toBe("Output 1,Center,1280,384,1536,768,1280,384,1536,768,512,0,512,0");
  });

  it("quotes commas and defuses spreadsheet formulas in names", () => {
    const { project, ids } = setup();
    const renamed = ops.updateScreen(ops.updateScreen(project, ids.left, { name: "Left, upper" }), ids.right, { name: "=HYPERLINK(1)" });
    const csv = buildSlicesCsv(buildResolumeSetup(resolveMapping(renamed)));
    expect(csv).toContain('"Left, upper"');
    expect(csv).toContain("'=HYPERLINK(1)");
  });

  it("writes a guide with this project's values", () => {
    const { project, mapping } = setup();
    const guide = buildResolumeGuide(project, buildResolumeSetup(mapping), { masterPng: "pixelmaps/master.png" });
    expect(guide).toContain("2432 × 768");
    expect(guide).toContain("| Right | 2240 | 320 | 384 | 640 | 2240 | 320 | 384 | 640 |");
    expect(guide).toContain("Match Output Shape");
    expect(guide).toContain("no Resolume preset file");
  });
});

describe("Resolume values to type: centres (O11, Arena 7.28.1)", () => {
  // The values the owner typed in Arena, whose saved XML then held exactly the mapping's rectangles.
  const TYPED = { "Wall A": [485, 293, 397, 263], "Wall B": [1387, 229, 1285, 199], "Strip C": [605, 861, 959, 983] };
  const pixelTest = () => {
    const project = pixelTestProject();
    const mapping = resolveMapping(project);
    return { project, mapping, setup: buildResolumeSetup(mapping) };
  };
  /** One screen made 1 px wider, as an odd cabinet would. Its output stays inside. */
  const odd = (patch: { width?: number; height?: number }) => {
    const { project, mapping } = pixelTest();
    const grow = (r: { x: number; y: number; width: number; height: number }) => ({ ...r, width: px(r.width + (patch.width ?? 0)), height: px(r.height + (patch.height ?? 0)) });
    const screens = mapping.screens.map((s) => (s.name === "Wall B" ? { ...s, masterRect: grow(s.masterRect), outputRect: grow(s.outputRect) } : s));
    return { project, setup: buildResolumeSetup({ ...mapping, screens } as typeof mapping) };
  };

  it("are the ones that gave exact rectangles in Arena", () => {
    const slices = pixelTest().setup.screens.flatMap((s) => s.slices);
    expect(Object.fromEntries(slices.map((s) => [s.name, [s.input.centerX, s.input.centerY, s.output.centerX, s.output.centerY]]))).toEqual(TYPED);
    // Back from centre and size to the top-left corner the mapping says: nothing was lost.
    for (const s of slices) {
      for (const r of [s.input, s.output]) expect([r.centerX - r.width / 2, r.centerY - r.height / 2]).toEqual([r.left, r.top]);
    }
    expect(slices[0].input).toMatchObject({ left: 101, top: 37 });
  });

  it("are the first table of the guide and the first columns of the CSV; top-left corners are apart and named", () => {
    const { project, setup: resolume } = pixelTest();
    const guide = buildResolumeGuide(project, resolume, { masterPng: "m.png" });
    const [values, reference] = guide.split("### For reference only: top-left corners");
    expect(values).toContain("| Wall A | 485 | 293 | 768 | 512 | 397 | 263 | 768 | 512 |");
    expect(values).toContain("| Strip C | 605 | 861 |");
    expect(values).not.toContain("| 101 | 37 |");
    expect(reference).toContain("| Wall A | OUT 1 | 101 | 37 | 13 | 7 |");
    expect(guide).toContain("Arena 7.28.1");
    expect(guide).toContain("Output > Disabled");
    expect(guide).not.toMatch(/(Input|Output) [XY]\b/);
    expect(guide).not.toContain("Warning: half-pixel");

    const csv = buildSlicesCsv(resolume).trim().split("\r\n");
    expect(csv[0].split(",").filter((c) => /_[xy]$/.test(c) && !/_center_[xy]$/.test(c))).toEqual([]);
    expect(csv[1]).toBe("OUT 1,Wall A,485,293,768,512,397,263,768,512,101,37,13,7");
  });

  it("keep the half pixel of an odd size, and the guide warns about exactly those slices", () => {
    expect(halfPixelSlices(pixelTest().setup)).toEqual([]);
    for (const patch of [{ width: 1 }, { height: 1 }]) {
      const { project, setup: resolume } = odd(patch);
      expect(halfPixelSlices(resolume).map((s) => s.name)).toEqual(["Wall B"]);
      const guide = buildResolumeGuide(project, resolume, { masterPng: "m.png" });
      expect(guide).toContain("Warning: half-pixel centres.** “Wall B” (OUT 1):");
      expect(guide).not.toContain("“Wall A” (OUT 1):");
      expect(guide).toContain(patch.width ? "| Wall B | 1387.5 | 229 | 769 | 384 | 1285.5 | 199 | 769 | 384 |" : "| Wall B | 1387 | 229.5 | 768 | 385 | 1285 | 199.5 | 768 | 385 |");
      expect(buildSlicesCsv(resolume)).toContain(patch.width ? "Wall B,1387.5,229," : "Wall B,1387,229.5,");
    }
  });

  it("leave manifest.json as it was: top-left corners, stated", () => {
    const { project, mapping } = pixelTest();
    const manifest = JSON.parse(JSON.stringify(buildManifest(project, mapping, [], NOW)));
    expect(manifest.coordinateSystem.origin).toBe("top-left");
    expect(manifest.version).toBe(1);
  });
});

describe("Resolume package", () => {
  const fakePng = async () => new Blob(["png"]);

  it("contains every required file", async () => {
    const { project, mapping, issues } = setup();
    const { rootName, files } = await buildResolumePackage(project, mapping, issues, NOW, fakePng);
    const paths = files.map((f) => f.path);
    expect(rootName).toBe("test-show_resolume_2432x768");
    expect(paths).toEqual(expect.arrayContaining([
      "README.md",
      "manifest.json",
      "slices.csv",
      "mapping-report.md",
      "project/test-show.pixellab.json",
      "pixelmaps/master_2432x768.png",
      "pixelmaps/master_2432x768.svg",
      "pixelmaps/outputs/output-1_2432x768.png",
      "pixelmaps/screens/left_512x768.png",
      "pixelmaps/screens/center_1536x768.svg",
      "pixelmaps/screens/right_384x640.png",
    ]));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps files distinct when screens share a name and size", async () => {
    const { project, ids } = setup();
    const same = ops.updateScreen(project, ids.left, { name: "Wing", columns: 3, rows: 5 });
    const next = ops.updateScreen(same, ids.right, { name: "Wing" });
    const mapping = resolveMapping(next);
    const { files } = await buildResolumePackage(next, mapping, [], NOW, fakePng);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("pixelmaps/screens/wing_384x640.png");
    expect(paths).toContain("pixelmaps/screens/wing_384x640-2.png");
  });

  it("includes a project file that reopens identically", async () => {
    const { project, mapping, issues } = setup();
    const { files } = await buildResolumePackage(project, mapping, issues, NOW, fakePng);
    const file = files.find((f) => f.path.endsWith(".pixellab.json"))!;
    expect(parseProjectFile(file.content as string)).toEqual(project);
  });

  it("refuses to build while errors exist", async () => {
    const { project, ids } = setup();
    const bad = ops.setRegionPosition(project, ids.right, px(0), px(0));
    const mapping = resolveMapping(bad);
    const issues = validateProject(bad, mapping);
    await expect(buildResolumePackage(bad, mapping, issues, NOW, fakePng)).rejects.toBeInstanceOf(ExportBlockedError);
    expect(() => assertExportable(issues)).toThrow(/overlaps/);
  });
});

describe("slugify", () => {
  it("makes safe file names", () => {
    expect(slugify("Festival Ñandú 2026 / Main!")).toBe("festival-nandu-2026-main");
    expect(slugify("///")).toBe("untitled");
    expect(slugify("../../etc")).toBe("etc");
  });
});
