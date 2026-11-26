import { describe, expect, it } from "vitest";
import { toProjectCabinet, YESTECH_MG6S_P26_INDOOR } from "@/domain/cabinets";
import { overlaps } from "@/engines/geometry";
import { assignUnits, cutSpans, fitIssues, guidedOutputsNeeded, minimumOutputs, minimumUnits, outputItems, partsForAnswer, planOutputs, sizeScreens, type ScreenPart, type ScreenSizing } from "@/engines/guided-led";
import { manualPlenary, P391 } from "./design-guided-led-fixtures";

const P26 = toProjectCabinet(YESTECH_MG6S_P26_INDOOR);
const OUT = { width: 3840, height: 2160 };

function plenary(cabinet = P26): readonly ScreenSizing[] {
  const layout = manualPlenary().layout;
  const r = sizeScreens(layout, { cabinets: Object.fromEntries(layout.map((s) => [s.key, cabinet])), rounding: {} });
  if (!r.ok) throw new Error("not sized");
  return r.screens;
}

describe("a screen larger than one output", () => {
  it("P2.6 plenary: only the centre doesn't fit, and it says the numbers", () => {
    const screens = plenary();
    expect(screens.map((s) => s.widthPx)).toEqual([1344, 2304, 5376, 2304, 1344]);
    expect(fitIssues(screens, OUT).map((f) => f.text)).toEqual(["Centre is 5376 px wide; one output is 3840 px."]);
    expect(guidedOutputsNeeded(screens, OUT)).toBeNull();
  });

  it("P3.91 stays as today: nothing to ask", () => {
    expect(fitIssues(plenary(P391), OUT)).toEqual([]);
  });

  it("cut options, on whole cabinets: equal halves, as many as fit, or a chosen column", () => {
    expect(cutSpans(28, 192, 3840, { mode: "equal" })).toEqual([14, 14]);
    expect(cutSpans(28, 192, 3840, { mode: "fill" })).toEqual([20, 8]);
    expect(cutSpans(28, 192, 3840, { mode: "custom", at: 10 })).toEqual([10, 18]);
    expect(cutSpans(28, 192, 3840, { mode: "custom", at: 6 })).toBe("Part 2 would be 22 cabinets (4224 px), more than one output holds (20 cabinets, 3840 px).");
    expect(cutSpans(28, 192, 3840, { mode: "custom", at: 28 })).toBe("Choose a cut between cabinet 1 and 27.");
    expect(cutSpans(45, 192, 3840, { mode: "equal" })).toEqual([15, 15, 15]);
    expect(cutSpans(4, 4000, 3840, { mode: "equal" })).toMatch(/more than one output/);
  });

  it.each([{ mode: "equal" as const }, { mode: "fill" as const }, { mode: "custom" as const, at: 11 }])("parts are exactly the screen: %o", (answer) => {
    const centre = plenary()[2];
    const parts = partsForAnswer(centre, "columns", OUT, answer) as ScreenPart[];
    expect(Array.isArray(parts)).toBe(true);
    // Pixel union: every pixel column of the screen in exactly one part, every row in all of them.
    const cover = new Array(centre.widthPx).fill(0);
    for (const p of parts) {
      expect(p.source.x % centre.cabinet.pixelsX).toBe(0);
      expect(p.source.width % centre.cabinet.pixelsX).toBe(0);
      expect(p.source).toMatchObject({ y: 0, height: centre.heightPx });
      for (let x = p.source.x; x < p.source.x + p.source.width; x++) cover[x]++;
      expect(p.source.width).toBeLessThanOrEqual(OUT.width);
    }
    expect(cover.every((n) => n === 1)).toBe(true);
    expect(parts.map((p) => p.key)).toEqual(parts.map((_, i) => `${centre.key}#${i + 1}`));
  });

  it("with the centre in halves: every part inside an output, no overlaps, the fewest outputs", () => {
    const screens = plenary();
    const centre = screens[2];
    const parts = { [centre.key]: partsForAnswer(centre, "columns", OUT, { mode: "equal" }) as ScreenPart[] };
    const items = outputItems(screens, parts);
    expect(items.map((i) => i.label)).toEqual(["Side left", "Wing left", "Centre · part 1/2", "Centre · part 2/2", "Wing right", "Side right"]);
    const n = minimumOutputs(items, OUT)!;
    expect(n).toBe(4);
    const plan = planOutputs(items, OUT, n);
    expect(plan.unplaced).toEqual([]);
    for (let bin = 0; bin < n; bin++) {
      const rects = items.filter((it) => plan.placements.get(it.key)!.bin === bin).map((it) => ({ ...plan.placements.get(it.key)!, width: it.width, height: it.height }));
      for (const r of rects) {
        expect(r.x + r.width).toBeLessThanOrEqual(OUT.width);
        expect(r.y + r.height).toBeLessThanOrEqual(OUT.height);
      }
      rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    }
    expect(minimumOutputs(items, OUT, 3)).toBeNull();
    // An operator's pin is kept, or the item is reported unplaced; never forced.
    expect(planOutputs(items, OUT, 4, { [`${centre.key}#2`]: 0, [`${centre.key}#1`]: 0 }).unplaced).toEqual([`${centre.key}#2`]);
  });

  it("processor load: VX1000 at 6.5 M px (unchecked) needs at least 3 by total, 4 when outputs can't be shared", () => {
    const screens = plenary();
    const centre = screens[2];
    const items = outputItems(screens, { [centre.key]: partsForAnswer(centre, "columns", OUT, { mode: "equal" }) as ScreenPart[] });
    const plan = planOutputs(items, OUT, 4);
    const total = plan.used.reduce((a, b) => a + b, 0);
    expect(total).toBe(12672 * 1344);
    expect(Math.ceil(total / 6_500_000)).toBe(3);
    expect(minimumUnits(plan.used, 6_500_000)).toBe(4);
    const three = assignUnits(plan.used, 3, 6_500_000);
    expect(three.over.length).toBeGreaterThan(0);
    const four = assignUnits(plan.used, 4, 6_500_000);
    expect(four.over).toEqual([]);
    expect(new Set(four.unitOf).size).toBe(4);
  });
});

describe("split screens built into the project (schema 3)", () => {
  const build = async (answer: { mode: "equal" | "fill" | "custom"; at?: number } = { mode: "equal" }) => {
    const { buildGuidedProject } = await import("@/engines/guided-led");
    const ops = await import("@/engines/project-ops");
    const { testContext } = await import("./helpers");
    const screens = plenary();
    const centre = screens[2];
    const parts = { [centre.key]: partsForAnswer(centre, "columns", OUT, answer) as ScreenPart[] };
    const n = minimumOutputs(outputItems(screens, parts), OUT)!;
    const ctx = testContext();
    return buildGuidedProject(ops.createProject({ name: "Plenary P2.6" }, ctx), screens, { ...OUT, count: n, parts }, ctx);
  };

  it.each([{ mode: "equal" as const }, { mode: "fill" as const }])("P2.6 plenary at 3840×2160, %o: ready, every part inside an output, no overlap, parts exactly the screen", async (answer) => {
    const b = await build(answer);
    expect(b.blocking).toEqual([]);
    expect(b.issues.filter((i) => i.severity === "error")).toEqual([]);
    for (const s of b.mapping.screens) {
      // Pixel union: every screen pixel in exactly one part.
      const cover = new Uint8Array(s.spec.pixelWidth * s.spec.pixelHeight);
      for (const p of s.parts) for (let y = p.source.y; y < p.source.y + p.source.height; y++) for (let x = p.source.x; x < p.source.x + p.source.width; x++) cover[y * s.spec.pixelWidth + x]++;
      expect(cover.every((v) => v === 1)).toBe(true);
    }
    const centre = b.mapping.screens.find((s) => s.name === "Centre")!;
    expect(centre.parts.map((p) => p.source.width)).toEqual(answer.mode === "equal" ? [2688, 2688] : [3840, 1536]);
    expect(new Set(centre.parts.map((p) => p.outputId)).size).toBe(2);
    for (const o of b.mapping.outputs) {
      const rects = b.mapping.screens.flatMap((s) => s.parts.filter((p) => p.outputId === o.outputId).map((p) => p.outputRect));
      for (const r of rects) expect(r.x + r.width <= o.width && r.y + r.height <= o.height).toBe(true);
      rects.forEach((a, i) => rects.slice(i + 1).forEach((c) => expect(overlaps(a, c)).toBe(false)));
    }
  });

  it("the Resolume CSV gives one row per part, and the parts' inputs tile the screen's region", async () => {
    const { buildResolumeSetup, buildSlicesCsv } = await import("@/exports/resolume/adapter");
    const b = await build();
    const setup = buildResolumeSetup(b.mapping);
    const rows = buildSlicesCsv(setup).trim().split("\r\n").slice(1);
    expect(rows).toHaveLength(6);
    const centreRows = rows.filter((r) => r.includes("Centre"));
    expect(centreRows.map((r) => r.split(",")[1])).toEqual(["Centre · part 1/2", "Centre · part 2/2"]);
    const slices = setup.screens.flatMap((s) => s.slices).filter((s) => s.name.startsWith("Centre"));
    const centre = b.mapping.screens.find((s) => s.name === "Centre")!;
    expect(slices.map((s) => [s.input.left, s.input.width])).toEqual([[centre.masterRect.x, 2688], [centre.masterRect.x + 2688, 2688]]);
    expect(slices.every((s) => s.input.width === s.output.width && s.input.height === s.output.height)).toBe(true);
    // No rotation or mirror: no extra columns.
    expect(buildSlicesCsv(setup).split("\r\n")[0]).not.toContain("rotation");
  });

  it("test cards: the cut is visible, cabinet ids continue across it", async () => {
    const { guidedCards } = await import("@/components/shell/guided-led/cards");
    const { cabinetCells, cabinetLabelText } = await import("@/components/shell/calibration/frame");
    const b = await build();
    const cards = guidedCards(b.mapping, { only: null }).filter((c) => c.kind === "output");
    const centreParts = cards.flatMap((c) => c.target.screens.filter((s) => s.name.startsWith("Centre")).map((s) => ({ s, frame: c.frame })));
    expect(centreParts.map((p) => p.s.name).sort()).toEqual(["Centre · part 1/2", "Centre · part 2/2"]);
    const ids = centreParts.flatMap(({ s, frame }) => cabinetCells(s).map((cell) => {
      const text = cabinetLabelText(cell, s.cabinetPrefix);
      expect(frame.nodes.some((n) => n.kind === "text" && n.text === text)).toBe(true);
      return text;
    }));
    const columns = new Set(ids.map((t) => Number(t.split("·C")[1])));
    expect([...columns].sort((a, c) => a - c)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
    expect(ids).toContain("C·R1·C14");
    expect(ids).toContain("C·R1·C15");
    expect(new Set(ids).size).toBe(28 * 7);
  });

  it("rotation and mirror from the flow reach the project; the canvas gives a turned screen room", async () => {
    const { buildGuidedProject } = await import("@/engines/guided-led");
    const ops = await import("@/engines/project-ops");
    const { testContext } = await import("./helpers");
    const screens = plenary(P391);
    const ctx = testContext();
    const b = buildGuidedProject(ops.createProject({ name: "Turned" }, ctx), screens, { width: 3840, height: 2160, count: 4, turns: { [screens[0].key]: { rotation: 45, flip: "h" } } }, ctx);
    const left = b.mapping.screens[0];
    expect([left.rotation, left.flip]).toEqual([45, "h"]);
    expect(b.issues.filter((i) => i.code === "REGION_OVERLAP" || i.code === "REGION_NEGATIVE")).toEqual([]);
  });
});

describe("Resolume values for a turned screen", () => {
  it("45° writes orientation 0.785398 and corners turned about the centre to within 0.01 px; mirror is written", async () => {
    const { buildResolumeSetup, buildSlicesCsv, orientationRadians } = await import("@/exports/resolume/adapter");
    const ops = await import("@/engines/project-ops");
    const { resolveMapping } = await import("@/engines/mapping");
    const { threeScreenProject } = await import("./helpers");
    const { project, ids } = threeScreenProject();
    const p = ops.setRegionFlip(ops.setRegionRotation(project, ids.left, 45), ids.left, "h");
    const m = resolveMapping(p);
    const left = m.screens.find((s) => s.screenId === ids.left)!;
    const slice = buildResolumeSetup(m).screens.flatMap((s) => s.slices).find((s) => s.name === left.name)!;
    expect(orientationRadians(slice.rotation)).toBe(0.785398);
    const r = left.masterRect;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const t = Math.PI / 4;
    const want = [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]].map(([x, y]) => ({ x: cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t), y: cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t) }));
    slice.inputCorners.forEach((c, i) => {
      expect(Math.abs(c.x - want[i].x)).toBeLessThan(0.01);
      expect(Math.abs(c.y - want[i].y)).toBeLessThan(0.01);
    });
    const csv = buildSlicesCsv(buildResolumeSetup(m));
    expect(csv.split("\r\n")[0]).toContain("input_rotation_deg,input_orientation_rad,flip");
    expect(csv).toContain(",45,0.785398,h");
  });
});
