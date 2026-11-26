import { describe, expect, it } from "vitest";
import { readPdf } from "@/components/shell/guided-led/pdf-reader";
import { calibrationTargets } from "@/components/shell/calibration/from-mapping";
import { buildCalibrationFrame, cabinetCells, cabinetLabelText } from "@/components/shell/calibration/frame";
import { guidedCards } from "@/components/shell/guided-led/cards";
import {
  buildGuidedProject,
  countFor,
  EMPTY_GUIDED_RECORD,
  fitAxis,
  formatUm,
  GUIDED_MODULE_ID,
  GUIDED_MODULE_VERSION,
  guidedOutputsNeeded,
  layoutFromProposal,
  parseDimension,
  parseGuidedRecord,
  readDrawing,
  sizeScreens,
  type DrawingPage,
  type GuidedAnswers,
  type LaidOutScreen,
} from "@/engines/guided-led";
import { overlaps } from "@/engines/geometry";
import * as ops from "@/engines/project-ops";
import { parseProjectFile, serializeProject } from "@/persistence/schema";
import { manualPlenary, P391, PLENARY, PLENARY_PDF } from "./design-guided-led-fixtures";
import { testContext } from "./helpers";

const allP391 = (layout: readonly LaidOutScreen[], rounding: GuidedAnswers["rounding"] = {}): GuidedAnswers => ({ cabinets: Object.fromEntries(layout.map((s) => [s.key, P391])), rounding });

async function readPlenaryPdf() {
  const pdf = await readPdf(PLENARY_PDF());
  return { pdf, proposal: readDrawing(pdf.page) };
}

function sized(layout: readonly LaidOutScreen[], rounding: GuidedAnswers["rounding"] = {}) {
  const r = sizeScreens(layout, allP391(layout, rounding));
  if (!r.ok) throw new Error(`Not sized: ${JSON.stringify(r)}`);
  return r.screens;
}

describe("dimension labels", () => {
  it.each([
    ["3.5", 3_500_000, "m", true],
    ["3,50 m", 3_500_000, "m", false],
    ["3.50m", 3_500_000, "m", false],
    ["6000", 6_000_000, "mm", true],
    ["6000 mm", 6_000_000, "mm", false],
    ["350 cm", 3_500_000, "cm", false],
    ["14.00", 14_000_000, "m", true],
    ["0.125", 125_000, "m", true],
    ["12", 12_000_000, "m", true],
    ["2.5 mm", 2_500, "mm", false],
  ])("%s", (text, umValue, unit, assumed) => {
    expect(parseDimension(text)).toEqual({ um: umValue, unit, unitAssumed: assumed, text });
  });

  it.each(["", "Side left", "1:100", "+0.00", "3.5 ft", "0", "3.1234567", "-2", "1.2.3"])("not a dimension: %s", (text) => {
    expect(parseDimension(text)).toBeNull();
  });

  it("formats micrometres without rounding", () => {
    expect(formatUm(3_500_000)).toBe("3.5 m");
    expect(formatUm(14_000_000)).toBe("14 m");
    expect(formatUm(100_000)).toBe("0.1 m");
    expect(formatUm(2_500)).toBe("2.5 mm");
  });
});

describe("reading the plenary drawing", () => {
  it("vector PDF: the five screens, their sizes and gaps are read automatically", async () => {
    const { pdf, proposal } = await readPlenaryPdf();
    expect(pdf.page.kind).toBe("vector");
    expect(proposal.notes).toEqual([]);
    expect(proposal.screens.map((s) => s.name)).toEqual(PLENARY.names.map((value) => ({ value, source: "read" })));
    expect(proposal.screens.map((s) => [s.width.value, s.width.source])).toEqual(PLENARY.widthsUm.map((w) => [w, "read"]));
    expect(proposal.screens.map((s) => [s.height.value, s.height.source])).toEqual(PLENARY.widthsUm.map(() => [PLENARY.heightUm, "read"]));
    expect(proposal.screens.every((s) => s.top.value === 0 && s.top.source === "read")).toBe(true);
    expect(proposal.gaps.map((g) => [g.um.value, g.um.source])).toEqual(PLENARY.gapsUm.map((g) => [g, "read"]));
    // Units without a label are reported as assumed, never hidden.
    expect(proposal.screens[1].width.note).toBe("Read “6000”, taken as millimetres");
    const layout = layoutFromProposal(proposal.screens, proposal.gaps);
    expect(layout.ok).toBe(true);
    await pdf.destroy();
  });

  it("an image can't be read: it says so and proposes nothing", () => {
    const page: DrawingPage = { kind: "raster", width: 2381, height: 1684, texts: [], rects: [] };
    const p = readDrawing(page);
    expect(p.screens).toEqual([]);
    expect(p.notes[0]).toMatch(/image.*nothing can be read.*Draw each screen/);
  });

  it("PNG, guided manual path: the same layout as the PDF", async () => {
    const { proposal } = await readPlenaryPdf();
    const fromPdf = layoutFromProposal(proposal.screens, proposal.gaps);
    if (!fromPdf.ok) throw new Error("PDF layout");
    const strip = (l: readonly LaidOutScreen[]) => l.map(({ name, widthUm, heightUm, gapBeforeUm, yUm }) => ({ name, widthUm, heightUm, gapBeforeUm, yUm }));
    expect(strip(manualPlenary().layout)).toEqual(strip(fromPdf.screens));
  });

  it("a missing value becomes a question pointed at the screens, never a made-up value", async () => {
    const { proposal } = await readPlenaryPdf();
    const gaps = proposal.gaps.map((g, i) => (i === 1 ? { ...g, um: { value: null, source: "missing" as const } } : g));
    const screens = proposal.screens.map((s, i) => (i === 3 ? { ...s, height: { value: 3_500_000, source: "guessed" as const, note: "drawn the same height as Side left" } } : s));
    const r = layoutFromProposal(screens, gaps);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.questions.map((q) => q.text)).toEqual(["Is Wing right 3.5 m tall? drawn the same height as Side left", "How big is the gap between Wing left and Centre?"]);
    expect(r.questions[1].about).toEqual(["s2", "s3"]);
    expect(layoutFromProposal(screens, gaps.map((g, i) => (i === 1 ? { ...g, um: { value: 1_500_000, source: "typed" as const } } : g)), new Set(["height:s4"])).ok).toBe(true);
  });

  it("a label squeezed between two screens goes to the screen that has no other label", () => {
    const page: DrawingPage = {
      kind: "vector",
      width: 1000,
      height: 600,
      rects: [
        { x: 100, y: 100, width: 200, height: 100 },
        { x: 330, y: 100, width: 200, height: 100 },
      ],
      texts: [
        { text: "3.5", x: 303, y: 140, width: 18, height: 8 }, // right of A, nearer B's edge
        { text: "3.5", x: 535, y: 140, width: 18, height: 8 }, // right of B
      ],
    };
    const p = readDrawing(page);
    expect(p.screens.map((s) => s.height.source)).toEqual(["read", "read"]);
    expect(p.notes).toEqual([]);
  });
});

describe("whole cabinets", () => {
  it("the plenary with Generic 500×500 P3.91: 7/12/28/12/7 × 7, exact pixels, 8448 × 896 in total", () => {
    const screens = sized(manualPlenary().layout);
    expect(screens.map((s) => [s.columns, s.rows])).toEqual(PLENARY.columns.map((c) => [c, PLENARY.rows]));
    expect(screens.map((s) => [s.widthPx, s.heightPx])).toEqual(PLENARY.pixels.map((p) => [p, 896]));
    expect(screens.reduce((n, s) => n + s.widthPx, 0)).toBe(8448);
    expect(screens.every((s) => s.warnings.length === 0)).toBe(true);
  });

  it("3.6 m is not whole cabinets: it asks, then follows the choice", () => {
    const layout = manualPlenary(3_600_000).layout;
    const r = sizeScreens(layout, allP391(layout));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.choices).toHaveLength(5);
    expect(r.choices[0].text).toBe("Side left is 3.6 m tall, not whole 0.5 m cabinets: 7 cabinets make 3.5 m (0.1 m less), or 8 make 4 m (0.4 m more).");
    const rounding = (choice: "down" | "up" | "keep") => Object.fromEntries(layout.map((s) => [`height:${s.key}`, choice]));
    expect(sized(layout, rounding("down")).map((s) => s.rows)).toEqual([7, 7, 7, 7, 7]);
    expect(sized(layout, rounding("up")).map((s) => s.rows)).toEqual([8, 8, 8, 8, 8]);
    const kept = sized(layout, rounding("keep"));
    expect(kept.map((s) => s.rows)).toEqual([7, 7, 7, 7, 7]);
    expect(kept[0].warnings).toEqual(["Side left: the drawing says 3.6 m tall; 7 cabinets make 3.5 m."]);
  });

  it("fit arithmetic is exact", () => {
    expect(fitAxis(3_500_000, 500_000)).toEqual({ sizeUm: 3_500_000, cabinetUm: 500_000, exact: true, down: 7, up: 7 });
    expect(fitAxis(400_000, 500_000)).toMatchObject({ exact: false, down: 0, up: 1 });
    expect(countFor(fitAxis(3_800_000, 500_000), "keep")).toBe(8);
    expect(countFor(fitAxis(3_750_000, 500_000), "keep")).toBe(8);
    expect(countFor(fitAxis(400_000, 500_000), "down")).toBe(0);
    // Rounding down to no cabinet at all is not offered as an answer.
    const layout = [{ ...manualPlenary().layout[0], heightUm: 400_000 }];
    const r = sizeScreens(layout, allP391(layout, { [`height:${layout[0].key}`]: "down" }));
    expect(r.ok).toBe(false);
  });
});

describe("pixel map", () => {
  const build = (size = { width: 3840, height: 2160 }, count?: number, assignment?: Record<string, number>) => {
    const screens = sized(manualPlenary().layout);
    const ctx = testContext();
    const project = ops.createProject({ name: "Plenary" }, ctx);
    return { screens, b: buildGuidedProject(project, screens, { ...size, count: count ?? guidedOutputsNeeded(screens, size)!, assignment }, ctx) };
  };

  it("8448 px doesn't fit one output: packed 1:1 over as many as needed, no overlap, nothing outside", () => {
    const { b } = build();
    expect(b.ready).toBe(true);
    expect(b.mapping.master).toMatchObject({ width: 8448, height: 896 });
    expect(b.mapping.outputs.map((o) => [o.width, o.height])).toEqual([[3840, 2160], [3840, 2160]]);
    expect(b.issues.filter((i) => i.severity === "error")).toEqual([]);
    for (const o of b.mapping.outputs) {
      const rects = b.mapping.screens.filter((s) => s.outputId === o.outputId).map((s) => s.outputRect);
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(o.width);
        expect(r.y + r.height).toBeLessThanOrEqual(o.height);
      }
      rects.forEach((a, i) => rects.slice(i + 1).forEach((c) => expect(overlaps(a, c)).toBe(false)));
    }
    // Master canvas: side by side in drawing order, no space between.
    expect(b.mapping.screens.map((s) => [s.name, s.masterRect.x, s.masterRect.width])).toEqual([
      ["Side left", 0, 896],
      ["Wing left", 896, 1536],
      ["Centre", 2432, 3584],
      ["Wing right", 6016, 1536],
      ["Side right", 7552, 896],
    ]);
    // Stage: whole cabinets with the drawing's gaps.
    expect(b.mapping.screens.map((s) => [s.stage.x, s.stage.width, s.stage.height])).toEqual([
      [0, 3_500_000, 3_500_000],
      [4_500_000, 6_000_000, 3_500_000],
      [12_000_000, 14_000_000, 3_500_000],
      [27_500_000, 6_000_000, 3_500_000],
      [34_500_000, 3_500_000, 3_500_000],
    ]);
  });

  it("the operator can move a screen to another output; a move that can't fit is said, not forced", () => {
    const { b } = build(undefined, 2, { s1: 1 });
    expect(b.ready).toBe(true);
    expect(b.placedIn.s1).toBe(1);
    const tooMany = build(undefined, 2, { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0 });
    expect(tooMany.b.ready).toBe(false);
    expect(tooMany.b.blocking[0]).toMatch(/doesn't fit in output 1 with the other screens sent there/);
  });

  it("1920×1080 outputs can't carry the 3584 px centre 1:1, and it says so", () => {
    const screens = sized(manualPlenary().layout);
    expect(guidedOutputsNeeded(screens, { width: 1920, height: 1080 })).toBeNull();
    const { b } = build({ width: 1920, height: 1080 }, 5);
    expect(b.ready).toBe(false);
    expect(b.blocking[0]).toBe("Larger than a 1920×1080 output: Centre (3584×896 px). Choose a larger output. Nothing is scaled.");
  });

  it("same input, same project", () => {
    expect(JSON.stringify(build().b.project)).toBe(JSON.stringify(build().b.project));
  });

  it("saved answers survive save and load, without a schema change", () => {
    const { b } = build();
    const { screens, gaps } = manualPlenary();
    const record = { ...EMPTY_GUIDED_RECORD, screens, gaps, cabinetIds: { s1: P391.id }, outputChoice: "generic-2160", outputSize: { width: 3840, height: 2160 }, outputCount: 2, assignment: { s1: 1 } };
    const project = ops.setModuleData(b.project, GUIDED_MODULE_ID, GUIDED_MODULE_VERSION, record);
    const loaded = parseProjectFile(serializeProject(project));
    expect(loaded).toEqual(project);
    expect(parseGuidedRecord(loaded.modules[GUIDED_MODULE_ID].data, GUIDED_MODULE_VERSION)).toEqual(record);
    expect(parseGuidedRecord({ nope: true }, 1)).toBeNull();
    expect(parseGuidedRecord(record, 2)).toBeNull();
  });
});

describe("test cards", () => {
  const plenary = () => {
    const screens = sized(manualPlenary().layout);
    const ctx = testContext();
    return buildGuidedProject(ops.createProject({ name: "Plenary" }, ctx), screens, { width: 3840, height: 2160, count: 2 }, ctx);
  };

  it("one card per output at the output's exact size, and one per screen", () => {
    const { mapping } = plenary();
    const cards = guidedCards(mapping, { only: null });
    expect(cards.filter((c) => c.kind === "output").map((c) => [c.frame.width, c.frame.height])).toEqual([[3840, 2160], [3840, 2160]]);
    expect(cards.filter((c) => c.kind === "screen").map((c) => [c.frame.width, c.frame.height])).toEqual(PLENARY.pixels.map((p) => [p, 896]));
    expect(cards.map((c) => c.fileName)).toEqual([
      "test-card_out-1_3840x2160.png",
      "test-card_out-2_3840x2160.png",
      "test-card_a-side-left_896x896.png",
      "test-card_b-wing-left_1536x896.png",
      "test-card_c-centre_3584x896.png",
      "test-card_d-wing-right_1536x896.png",
      "test-card_e-side-right_896x896.png",
    ]);
  });

  it("every cabinet carries its id, C·R3·C12 style, inside its own cabinet, on every card", () => {
    const { mapping } = plenary();
    let checked = 0;
    for (const card of guidedCards(mapping, { only: null })) {
      for (const s of card.target.screens) {
        for (const cell of cabinetCells(s)) {
          const text = cabinetLabelText(cell, s.cabinetPrefix);
          const node = card.frame.nodes.find((n) => n.kind === "text" && n.text === text);
          expect(node, `${card.fileName} ${text}`).toBeDefined();
          if (node?.kind !== "text") continue;
          expect(node.x).toBeGreaterThanOrEqual(cell.box.x);
          expect(node.y).toBeGreaterThanOrEqual(cell.box.y);
          expect(node.x + node.width).toBeLessThanOrEqual(cell.box.x + cell.box.width);
          expect(node.y + node.height).toBeLessThanOrEqual(cell.box.y + cell.box.height);
          checked++;
        }
      }
    }
    // 2 × 462 (outputs + screens), every cabinet twice.
    expect(checked).toBe(2 * 462);
    expect(cabinetLabelText({ row: 3, column: 12, number: 0, box: { x: 0, y: 0, width: 1, height: 1 } }, "C")).toBe("C·R3·C12");
  });

  it("each screen is named on its cards, with an orientation mark", () => {
    const { mapping } = plenary();
    for (const card of guidedCards(mapping, { only: null }).filter((c) => c.kind === "screen")) {
      const texts = card.frame.nodes.flatMap((n) => (n.kind === "text" ? [n.text] : []));
      expect(texts).toContain(card.target.screens[0].name);
      expect(texts).toContain("TOP");
    }
  });

  it("testing one screen: output cards show only that screen, the others stay black", () => {
    const { mapping } = plenary();
    const centre = mapping.screens.find((s) => s.name === "Centre")!;
    const cards = guidedCards(mapping, { only: centre.screenId });
    const outputs = cards.filter((c) => c.kind === "output");
    expect(outputs).toHaveLength(1);
    expect(outputs[0].target.screens.map((s) => s.name)).toEqual(["Centre"]);
    expect(outputs[0].frame.width).toBe(3840);
    expect(cards.filter((c) => c.kind === "screen").map((c) => c.target.screens[0].name)).toEqual(["Centre"]);
    expect(outputs[0].fileName).toBe(`test-card_out-${mapping.outputs.findIndex((o) => o.outputId === centre.outputId) + 1}_c-centre-only_3840x2160.png`);
  });

  it("existing calibration targets are unchanged without screen ids", () => {
    const { mapping } = plenary();
    const plain = calibrationTargets(mapping);
    expect(plain.every((t) => t.screens.every((s) => s.cabinetPrefix === undefined))).toBe(true);
    const frame = buildCalibrationFrame({ width: plain[1].width, height: plain[1].height, screens: plain[1].screens, mode: "identification", logo: { mode: "off", aspect: 1 }, fps: 30 as never });
    expect(frame.nodes.some((n) => n.kind === "text" && n.text === "A1")).toBe(true);
  });
});
