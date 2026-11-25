import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { Project } from "@/domain/model";
import { px } from "@/domain/units";
import { buildFastMap, parseScreenList, sameContent, swapOutputs, wallUpdate } from "@/engines/fast-map";
import { resolveMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { validateProject } from "@/engines/validation";
import { buildManifest } from "@/exports/manifest";
import { buildReport } from "@/exports/report";
import { buildResolumeSetup, buildSlicesCsv } from "@/exports/resolume/adapter";
import { masterScene, outputScene } from "@/exports/scene";
import { renderSvg } from "@/exports/svg";
import { parseProjectFile } from "@/persistence/schema";
import { useApp } from "@/state/store";
import { choices, HP_STAGE_LIST, SIZE_500 } from "./design-fast-map-fixtures";
import { testContext } from "./helpers";

function fm(): ops.OpContext {
  let n = 0;
  return { newId: () => `fm-${++n}`, now: () => "2026-11-25T00:00:00.000Z" };
}

/** The HP Stage map: eight screens, two same-size pairs (the towers and the blades). */
function hp(): { project: Project; id: Record<string, string> } {
  const screens = parseScreenList(HP_STAGE_LIST, { cabinets: choices(), sizeIfMissing: SIZE_500 }).screens;
  const build = buildFastMap(ops.createProject({ name: "HP" }, testContext()), screens, { mode: "replace", gapPx: 32, stageGapUm: 0, output: { width: 1920, height: 1080 }, newOutputs: 1 }, fm());
  return { project: build.project, id: Object.fromEntries(build.mapping.screens.map((s) => [s.name, s.screenId])) };
}

const rect = (p: Project, id: string, which: "masterRect" | "outputRect") => resolveMapping(p).screens.find((s) => s.screenId === id)![which];
const slice = (p: Project, id: string) => p.output.slices.find((s) => s.screenId === id)!;
const region = (p: Project, id: string) => p.content.regions.find((r) => r.screenId === id)!;
const errors = (p: Project) => validateProject(p, resolveMapping(p)).filter((i) => i.severity === "error");

/** Sets whether a screen's output follows its content, the inspector's "Same as content position". */
function follow(p: Project, id: string, follows: boolean): Project {
  return ops.setSliceFollowsContent(p, id, follows);
}

describe("swap outputs", () => {
  it("trades output position and output, and leaves content where it was", () => {
    const { project, id } = hp();
    const a = id["Torre izq"];
    const b = id["Torre der"];
    const next = swapOutputs(project, a, b);
    expect(rect(next, a, "outputRect")).toEqual(rect(project, b, "outputRect"));
    expect(rect(next, b, "outputRect")).toEqual(rect(project, a, "outputRect"));
    expect(slice(next, a).outputId).toBe(slice(project, b).outputId);
    expect(rect(next, a, "masterRect")).toEqual(rect(project, a, "masterRect"));
    expect(rect(next, b, "masterRect")).toEqual(rect(project, b, "masterRect"));
    expect(errors(next)).toEqual([]);
  });

  it("swapping twice is the identity", () => {
    const { project, id } = hp();
    const twice = swapOutputs(swapOutputs(project, id["Cuchilla izq"], id["Cuchilla der"]), id["Cuchilla izq"], id["Cuchilla der"]);
    expect(twice).toEqual(project);
  });

  it("swapping twice keeps the mapping even when outputs followed their content", () => {
    let { project } = hp();
    const { id } = hp();
    project = follow(follow(project, id["Torre izq"], true), id["Torre der"], true);
    const twice = swapOutputs(swapOutputs(project, id["Torre izq"], id["Torre der"]), id["Torre izq"], id["Torre der"]);
    expect(resolveMapping(twice).screens.map((s) => [s.outputId, s.outputRect, s.masterRect])).toEqual(resolveMapping(project).screens.map((s) => [s.outputId, s.outputRect, s.masterRect]));
    // Explicit afterwards, so a later content move can't undo the swap.
    expect(slice(twice, id["Torre izq"]).followsContent).toBe(false);
  });

  it("moves screens between outputs", () => {
    const { project, id } = hp();
    const added = ops.addOutput(project, "Output 2", fm());
    const moved = ops.setSlicePositions(ops.assignOutput(added.project, id["Torre der"], added.outputId), [{ id: id["Torre der"], x: px(0), y: px(0) }]);
    const next = swapOutputs(moved, id["Torre izq"], id["Torre der"]);
    expect(slice(next, id["Torre izq"]).outputId).toBe(added.outputId);
    expect(slice(next, id["Torre der"]).outputId).toBe(project.output.outputs[0].id);
  });

  it("refuses different sizes and the same screen, with the reason", () => {
    const { project, id } = hp();
    expect(() => swapOutputs(project, id["Torre izq"], id["Cuchilla izq"])).toThrow("“Torre izq” is 256×768 px and “Cuchilla izq” is 128×512 px. Only screens of the same size can do this 1:1.");
    expect(() => swapOutputs(project, id["DJ"], id["DJ"])).toThrow("Choose two different screens.");
    expect(() => swapOutputs(project, id["DJ"], "gone")).toThrow("Both screens must exist");
  });
});

describe("same content", () => {
  const cases = [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ] as const;

  it.each(cases)("source follows %s, target follows %s: target shows the source's content, both outputs stay put", (fromFollows, toFollows) => {
    let { project } = hp();
    const { id } = hp();
    const from = id["Cuchilla izq"];
    const to = id["Cuchilla der"];
    project = follow(follow(project, from, fromFollows), to, toFollows);
    // Following content puts a slice at its content position; place the target's output apart, as on a real wall.
    const outFromBefore = rect(project, from, "outputRect");
    const outToBefore = rect(project, to, "outputRect");
    const next = sameContent(project, from, to);
    expect(rect(next, to, "masterRect")).toEqual(rect(project, from, "masterRect"));
    expect(rect(next, from, "masterRect")).toEqual(rect(project, from, "masterRect"));
    expect(region(next, from).allowOverlap).toBe(true);
    expect(region(next, to).allowOverlap).toBe(true);
    expect(rect(next, to, "outputRect")).toEqual(outToBefore);
    expect(rect(next, from, "outputRect")).toEqual(outFromBefore);
    expect(slice(next, to).followsContent).toBe(false);
    expect(slice(next, from).followsContent).toBe(fromFollows);
    const issues = validateProject(next, resolveMapping(next));
    expect(issues.some((i) => i.code === "REGION_SHARED" && i.screenIds.includes(to))).toBe(true);
    expect(issues.some((i) => i.code === "REGION_OVERLAP" && i.screenIds.includes(to))).toBe(false);
  });

  it("the Act 4 trap: moving the target's content afterwards never moves its output", () => {
    let { project } = hp();
    const { id } = hp();
    const to = id["Cuchilla der"];
    project = follow(project, to, true);
    const outBefore = rect(project, to, "outputRect");
    const next = sameContent(project, id["Cuchilla izq"], to);
    const moved = ops.setRegionPosition(next, to, px(rect(next, to, "masterRect").x + 7), px(rect(next, to, "masterRect").y));
    expect(rect(moved, to, "outputRect")).toEqual(outBefore);
  });

  it("works across canvases", () => {
    const { project, id } = hp();
    const own = ops.makeScreenIndependent(project, id["Torre der"], fm());
    const next = sameContent(own.project, id["Torre izq"], id["Torre der"]);
    expect(region(next, id["Torre der"]).canvasId).toBe(region(next, id["Torre izq"]).canvasId);
    expect(rect(next, id["Torre der"], "masterRect")).toEqual(rect(next, id["Torre izq"], "masterRect"));
  });

  it("refuses different sizes", () => {
    const { project, id } = hp();
    expect(() => sameContent(project, id["Header"], id["Cinta"])).toThrow("Only screens of the same size can do this 1:1.");
  });
});

describe("one edit, one undo step", () => {
  const app = () => useApp.getState();
  const content = (p: Project) => ({ ...p, meta: { ...p.meta, revision: 0, updatedAt: "" } });

  beforeAll(async () => {
    await app().init();
  });

  it("creating the list, swapping and sharing content each undo exactly", async () => {
    await app().newProject({ name: "Fast map undo" });
    const start = content(app().project!);
    const screens = parseScreenList(HP_STAGE_LIST, { cabinets: choices(), sizeIfMissing: SIZE_500 }).screens;
    const steps = app().history.past.length;

    app().edit((p) => buildFastMap(p, screens, { mode: "replace", gapPx: 32, stageGapUm: 0, output: { width: 1920, height: 1080 }, newOutputs: 1 }, fm()).project);
    expect(app().history.past.length).toBe(steps + 1);
    const created = content(app().project!);
    const ids = Object.fromEntries(app().project!.physical.screens.map((s) => [s.name, s.id]));

    app().edit((p) => swapOutputs(p, ids["Torre izq"], ids["Torre der"]));
    const swapped = content(app().project!);
    app().edit((p) => sameContent(p, ids["Cuchilla izq"], ids["Cuchilla der"]));
    expect(app().history.past.length).toBe(steps + 3);

    app().undo();
    expect(content(app().project!)).toEqual(swapped);
    app().undo();
    expect(content(app().project!)).toEqual(created);
    app().undo();
    expect(content(app().project!)).toEqual(start);
  });
});

describe("send to the wall", () => {
  it("passes a map with no errors and holds one with errors, saying why", () => {
    const { project, id } = hp();
    const good = wallUpdate(project, resolveMapping(project), validateProject(project, resolveMapping(project)));
    expect(good.ok).toBe(true);
    const bad = ops.setSlicePositions(project, [{ id: id["DJ"], x: px(0), y: px(0) }]);
    const held = wallUpdate(bad, resolveMapping(bad), validateProject(bad, resolveMapping(bad)));
    expect(held).toEqual({ ok: false, reason: expect.stringMatching(/overlap.*The wall keeps the last good map\.$/) });
  });
});

describe("older projects and exported bytes are unchanged", () => {
  // Hashes of exports built on main (b433074) before Fast map existed. Any change to an existing function shows here.
  const FIXTURES = ["festival-main-stage.pixellab.json", "corporate-keynote.pixellab.json", "pixel-test.pixellab.json", "festival-main-stage.schema-1.pixellab.json"];
  const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
  function exportsOf(file: string) {
    const project = parseProjectFile(readFileSync(`tests/fixtures/${file}`, "utf8"));
    const mapping = resolveMapping(project);
    const issues = validateProject(project, mapping);
    const at = "2026-11-25T00:00:00.000Z";
    return {
      manifest: sha(JSON.stringify(buildManifest(project, mapping, issues, at))),
      report: sha(buildReport(project, mapping, issues, at)),
      svgMaster: sha(renderSvg(masterScene(mapping, "m"))),
      svgOutputs: sha(mapping.outputs.map((o) => renderSvg(outputScene(mapping, o.outputId, "o"))).join("\n")),
      slices: sha(buildSlicesCsv(buildResolumeSetup(mapping))),
    };
  }
  const EXPECTED: Record<string, ReturnType<typeof exportsOf>> = JSON.parse(readFileSync("tests/fixtures/fast-map-export-hashes.json", "utf8"));
  it.each(FIXTURES)("%s", (file) => {
    expect(exportsOf(file)).toEqual(EXPECTED[file]);
  });
  it("covers every fixture", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...FIXTURES].sort());
  });
  if (process.env.UPDATE_FAST_MAP_HASHES) {
    it("writes the hashes", async () => {
      const { writeFileSync } = await import("node:fs");
      writeFileSync("tests/fixtures/fast-map-export-hashes.json", JSON.stringify(Object.fromEntries(FIXTURES.map((f) => [f, exportsOf(f)])), null, 2) + "\n");
    });
  }
});
