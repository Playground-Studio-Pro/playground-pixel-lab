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
