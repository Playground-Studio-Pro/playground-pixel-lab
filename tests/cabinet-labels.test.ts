import { describe, expect, it } from "vitest";
import { buildCalibrationFrame, cabinetCells, cabinetLabelSize, cabinetLabelText, type CalibrationFrame, type CalibrationMode, type CalibrationScreen, type CalNode, type LogoMode } from "@/components/shell/calibration/frame";
import { calibrationTargets } from "@/components/shell/calibration/from-mapping";
import { CAL_LOGO_ASSET, CAL_MIN_TEXT } from "@/components/shell/calibration/tokens";
import { resolveMapping } from "@/engines/mapping";
import { buildExample } from "@/examples";

const ASPECT = CAL_LOGO_ASSET.width / CAL_LOGO_ASSET.height;
type Box = { x: number; y: number; width: number; height: number };
type Text = Extract<CalNode, { kind: "text" }>;
type Label = Extract<CalNode, { kind: "text" | "counter" }>;
const hits = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const RC = /^R(\d+) C(\d+)$/;
const NUM = /^#(\d+)$/;

const target = (example: "keynote" | "festival") => calibrationTargets(resolveMapping(buildExample(example)))[0];
const frameOf = (screens: readonly CalibrationScreen[], width: number, height: number, mode: CalibrationMode, logo: LogoMode, motion = true) =>
  buildCalibrationFrame({ width, height, screens, mode, logo: { mode: logo, aspect: ASPECT }, fps: 30, motion });
const texts = (f: CalibrationFrame) => f.nodes.filter((n): n is Text => n.kind === "text");
const labels = (f: CalibrationFrame) => f.nodes.filter((n): n is Label => n.kind === "text" || n.kind === "counter");

describe("cabinet grid from the mapping", () => {
  it("Corporate Keynote: 3 screens, 176 cabinets, numbered in reading order from each screen's top-left", () => {
    const t = target("keynote");
    const all = t.screens.map((s) => cabinetCells(s));
    expect(all.map((c) => c.length)).toEqual([32, 112, 32]);
    expect(all.flat()).toHaveLength(176);
    t.screens.forEach((s, i) => {
      const cells = all[i];
      const cab = s.cabinet!;
      cells.forEach((cell, k) => {
        expect(cell.number).toBe(k + 1);
        expect(cell.row).toBe(Math.floor(k / cab.columns) + 1);
        expect(cell.column).toBe((k % cab.columns) + 1);
        expect(cell.box).toEqual({ x: s.rect.x + (cell.column - 1) * cab.pixelsX, y: s.rect.y + (cell.row - 1) * cab.pixelsY, width: cab.pixelsX, height: cab.pixelsY });
      });
      // The cells tile the screen exactly.
      expect(cells.reduce((a, c) => a + c.box.width * c.box.height, 0)).toBe(s.rect.width * s.rect.height);
    });
  });

  it("Festival Main Stage: 324 cabinets across 6 screens, including a 36 × 1 ribbon", () => {
    const t = target("festival");
    expect(t.screens.map((s) => cabinetCells(s).length)).toEqual([128, 60, 60, 32, 36, 8]);
    const ribbon = cabinetCells(t.screens[4]);
    expect(ribbon.map((c) => c.row)).toEqual(Array(36).fill(1));
    expect(ribbon.at(-1)).toMatchObject({ column: 36, number: 36 });
  });

  it("no cabinet grid, no cells", () => {
    expect(cabinetCells({ label: "SCR-01", name: "x", rect: { x: 0, y: 0, width: 100, height: 100 }, canvasX: 0, canvasY: 0, accent: "#4F8DF7" })).toEqual([]);
  });
});

describe("cabinet label text", () => {
  const cell = (row: number, column: number, number: number) => ({ row, column, number, box: { x: 0, y: 0, width: 1, height: 1 } });
  it("single digits below 10, two digits for rows and columns once either reaches 10, the number as wide as the largest", () => {
    expect(cabinetLabelText(cell(2, 3, 7), 4, 2)).toEqual(["R2 C3", "#7"]);
    expect(cabinetLabelText(cell(2, 3, 7), 8, 4)).toEqual(["R2 C3", "#07"]);
    expect(cabinetLabelText(cell(1, 3, 3), 8, 14)).toEqual(["R01 C03", "#003"]);
    expect(cabinetLabelText(cell(1, 36, 36), 1, 36)).toEqual(["R01 C36", "#36"]);
    expect(cabinetLabelText(cell(100, 1, 9901), 120, 99)).toEqual(["R100 C001", "#09901"]);
  });
});

describe("cabinet label size and threshold (CAL_CABINET)", () => {
  it("scales with the cabinet, up to 32 px", () => {
    expect(cabinetLabelSize(128, 128, ["R01 C01", "#001"])).toBe(15);
    expect(cabinetLabelSize(192, 192, ["R01 C01", "#001"])).toBe(23);
    expect(cabinetLabelSize(500, 500, ["R01 C01", "#001"])).toBe(32);
  });
  it("is dropped below 9 px text: 35 × 30 px with single digits, 46 × 30 px with two", () => {
    expect(cabinetLabelSize(35, 30, ["R1 C1", "#1"])).toBe(CAL_MIN_TEXT);
    expect(cabinetLabelSize(34, 30, ["R1 C1", "#1"])).toBeNull();
    expect(cabinetLabelSize(35, 29, ["R1 C1", "#1"])).toBeNull();
    expect(cabinetLabelSize(46, 30, ["R01 C01", "#01"])).toBe(CAL_MIN_TEXT);
    expect(cabinetLabelSize(45, 30, ["R01 C01", "#01"])).toBeNull();
  });
});

describe("cabinet labels in the frame", () => {
  for (const example of ["keynote", "festival"] as const) {
    for (const mode of ["identification", "calibration"] as const) {
      for (const logo of ["center", "off"] as const) {
        it(`${example} ${mode}, logo ${logo}: inside their own cabinet, off the seams, clear of every label and the logo`, () => {
          const t = target(example);
          const f = frameOf(t.screens, t.width, t.height, mode, logo);
          const all = labels(f);
          const rc = texts(f).filter((n) => RC.test(n.text));
          expect(rc.length).toBeGreaterThan(0);
          for (const l of rc) {
            const s = t.screens[l.owner];
            const [, row, column] = RC.exec(l.text)!.map(Number);
            const cell = cabinetCells(s).find((c) => c.row === row && c.column === column)!;
            // The number sits under it, in the same cabinet.
            const num = texts(f).find((n) => n.owner === l.owner && NUM.test(n.text) && Number(NUM.exec(n.text)![1]) === cell.number && n.y > l.y && n.y - l.y < 3 * l.size);
            expect(num, `${s.label} ${l.text}`).toBeDefined();
            for (const n of [l, num!]) {
              // Inside the cabinet, never on its seam pixel (the first and last row and column).
              expect(n.x >= cell.box.x + 1 && n.y >= cell.box.y + 1 && n.x + n.width <= cell.box.x + cell.box.width - 1 && n.y + n.height <= cell.box.y + cell.box.height - 1, `${s.label} ${n.text}`).toBe(true);
              expect(n.size).toBeGreaterThanOrEqual(CAL_MIN_TEXT);
              if (f.logoKeepOut) expect(hits(n, f.logoKeepOut)).toBe(false);
              for (const o of all) if (o !== n) expect(hits(n, o), `${n.text} × ${o.kind === "text" ? o.text : o.field}`).toBe(false);
            }
          }
        });
      }
    }
  }

  it("Corporate Keynote, calibration: a free cabinet gets its top-left inset; a blocked corner moves to the next", () => {
    const t = target("keynote");
    const f = frameOf(t.screens, t.width, t.height, "calibration", "center");
    const main = t.screens.findIndex((s) => s.label === "SCR-02");
    // Cabinet (6, 2) of SCR-02 starts at master (960, 960); 192 px cabinets get 23 px text and an 8 px inset,
    // the number one line (23 px) and a 10 px gap below.
    expect(texts(f).find((n) => n.owner === main && n.text === "R06 C02")).toMatchObject({ x: 968, y: 968, size: 23 });
    expect(texts(f).find((n) => n.owner === main && n.text === "#072")).toMatchObject({ x: 968, y: 1001, size: 23 });
    // Cabinet (3, 1) starts at (768, 384). Its top-left corner is under the screen's metadata block, so the
    // label takes the bottom-left corner: 384 + 192 − 8 − 56.
    expect(texts(f).find((n) => n.owner === main && n.text === "R03 C01")).toMatchObject({ x: 776, y: 512 });
  });

  it("labels most cabinets and gives way where a screen's own labels or the logo are", () => {
    const t = target("keynote");
    const count = (mode: CalibrationMode, logo: LogoMode) => texts(frameOf(t.screens, t.width, t.height, mode, logo)).filter((n) => NUM.test(n.text)).length;
    expect(count("identification", "off")).toBe(154);
    expect(count("identification", "center")).toBe(142);
    expect(count("calibration", "off")).toBe(168);
    expect(count("calibration", "center")).toBe(150);
  });

  it("are in still frames too, and skipped in cabinets too small to read", () => {
    const t = target("keynote");
    expect(texts(frameOf(t.screens, t.width, t.height, "identification", "off", false)).some((n) => RC.test(n.text))).toBe(true);
    const tiny: CalibrationScreen = { label: "SCR-01", name: "Tiny", rect: { x: 0, y: 0, width: 640, height: 320 }, canvasX: 0, canvasY: 0, accent: "#4F8DF7", cabinet: { pixelsX: 32, pixelsY: 32, columns: 20, rows: 10 } };
    expect(texts(frameOf([tiny], 640, 320, "calibration", "off")).some((n) => RC.test(n.text) || NUM.test(n.text))).toBe(false);
  });

  it("where two screens overlap, the larger screen's cabinet labels stay out of the shared area", () => {
    const cab = { pixelsX: 128, pixelsY: 128, columns: 8, rows: 4 };
    const big: CalibrationScreen = { label: "SCR-01", name: "Big", rect: { x: 0, y: 0, width: 1024, height: 512 }, canvasX: 0, canvasY: 0, accent: "#4F8DF7", cabinet: cab };
    const small: CalibrationScreen = { label: "SCR-02", name: "Small", rect: { x: 512, y: 256, width: 512, height: 256 }, canvasX: 512, canvasY: 256, accent: "#2BC4B6", cabinet: { ...cab, columns: 4, rows: 2 } };
    const f = frameOf([big, small], 1024, 512, "calibration", "off");
    const shared = { x: 512, y: 256, width: 512, height: 256 };
    for (const n of texts(f).filter((x) => x.owner === 0 && (RC.test(x.text) || NUM.test(x.text)))) expect(hits(n, shared), n.text).toBe(false);
  });
});
