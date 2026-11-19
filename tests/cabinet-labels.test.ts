import { describe, expect, it } from "vitest";
import { buildCalibrationFrame, cabinetCells, cabinetLabelSize, cabinetLabelText, diagonalRuns, metres, ringRuns, rowLetters, type CalibrationFrame, type CalibrationMode, type CalibrationScreen, type CalNode, type LogoMode } from "@/components/shell/calibration/frame";
import { calibrationTargets } from "@/components/shell/calibration/from-mapping";
import { CAL_CHECKER, CAL_COLORS, CAL_LOGO_ASSET, CAL_MIN_TEXT, readableOn, tint } from "@/components/shell/calibration/tokens";
import { resolveMapping } from "@/engines/mapping";
import { buildExample } from "@/examples";

const ASPECT = CAL_LOGO_ASSET.width / CAL_LOGO_ASSET.height;
type Box = { x: number; y: number; width: number; height: number };
type Text = Extract<CalNode, { kind: "text" }>;
type Label = Extract<CalNode, { kind: "text" | "counter" }>;
const hits = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const CAB = /^([A-Z]+)(\d+)$/;
const rowOf = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

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
  const cell = (row: number, column: number) => ({ row, column, number: 0, box: { x: 0, y: 0, width: 1, height: 1 } });
  it("row letter and column number from the top-left: A1, A27, B1; past Z, AA", () => {
    expect([1, 2, 26, 27, 28, 52, 53, 702, 703].map(rowLetters)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
    expect(cabinetLabelText(cell(1, 1))).toBe("A1");
    expect(cabinetLabelText(cell(1, 27))).toBe("A27");
    expect(cabinetLabelText(cell(2, 1))).toBe("B1");
    expect(cabinetLabelText(cell(27, 3))).toBe("AA3");
  });
});

describe("cabinet label size and threshold (CAL_CABINET)", () => {
  it("scales with the cabinet, up to 96 px", () => {
    expect(cabinetLabelSize(128, 128, "A1")).toBe(36);
    expect(cabinetLabelSize(192, 192, "N14")).toBe(54);
    expect(cabinetLabelSize(1000, 1000, "A1")).toBe(96);
  });
  it("shrinks to fit and is dropped below 9 px: 17 × 15 px for A1, 23 × 15 px for A12", () => {
    expect(cabinetLabelSize(17, 15, "A1")).toBe(CAL_MIN_TEXT);
    expect(cabinetLabelSize(16, 15, "A1")).toBeNull();
    expect(cabinetLabelSize(17, 14, "A1")).toBeNull();
    expect(cabinetLabelSize(23, 15, "A12")).toBe(CAL_MIN_TEXT);
    expect(cabinetLabelSize(22, 15, "A12")).toBeNull();
    // Longer labels shrink before they are dropped.
    expect(cabinetLabelSize(60, 300, "AAA123")).toBeLessThan(cabinetLabelSize(60, 300, "A1")!);
  });
});

describe("cabinet labels in the frame", () => {
  for (const example of ["keynote", "festival"] as const) {
    for (const mode of ["identification", "calibration"] as const) {
      for (const logo of ["center", "off"] as const) {
        it(`${example} ${mode}, logo ${logo}: centered in their own cabinet, off the seams, clear of every label and the logo`, () => {
          const t = target(example);
          const f = frameOf(t.screens, t.width, t.height, mode, logo);
          const all = labels(f);
          const cab = texts(f).filter((n) => CAB.test(n.text) && t.screens[n.owner].cabinet);
          expect(cab.length).toBeGreaterThan(0);
          for (const l of cab) {
            const s = t.screens[l.owner];
            const [, letters, col] = CAB.exec(l.text)!;
            const cell = cabinetCells(s).find((c) => c.row === rowOf(letters) && c.column === Number(col))!;
            expect(cell, `${s.label} ${l.text}`).toBeDefined();
            // Centered, or nudged at most a quarter of the cabinet where a corner mark is in the way; never on
            // the seam pixel.
            const ox = l.x + l.width / 2 - (cell.box.x + cell.box.width / 2);
            const oy = l.y + l.height / 2 - (cell.box.y + cell.box.height / 2);
            expect(ox >= -1 && ox <= cell.box.width / 4 + 1 && oy >= -1 && oy <= cell.box.height / 4 + 1, `${l.text} ${ox},${oy}`).toBe(true);
            expect(l.x >= cell.box.x + 1 && l.y >= cell.box.y + 1 && l.x + l.width <= cell.box.x + cell.box.width - 1 && l.y + l.height <= cell.box.y + cell.box.height - 1).toBe(true);
            expect(l.size).toBeGreaterThanOrEqual(CAL_MIN_TEXT);
            if (f.logoKeepOut) expect(hits(l, f.logoKeepOut)).toBe(false);
            for (const o of all) if (o !== l) expect(hits(l, o), `${l.text} × ${o.kind === "text" ? o.text : o.field}`).toBe(false);
          }
        });
      }
    }
  }

  it("identification: every screen of Corporate Keynote labels its first cabinet A1, beside the corner mark", () => {
    // In calibration the top-left cabinet holds the screen's metadata block, and cabinet labels give way to it.
    const t = target("keynote");
    const f = frameOf(t.screens, t.width, t.height, "identification", "off");
    t.screens.forEach((s, i) => expect(texts(f).some((n) => n.owner === i && n.text === "A1"), s.label).toBe(true));
  });

  it("Corporate Keynote, calibration: E3 of the main wall is centered in its cabinet", () => {
    const t = target("keynote");
    const f = frameOf(t.screens, t.width, t.height, "calibration", "off");
    const main = t.screens.findIndex((s) => s.label === "SCR-02");
    // Row 5 (E), column 3 starts at master (768 + 2 × 192, 4 × 192) = (1152, 768). 54 px text; "E3" is 65 px wide.
    expect(texts(f).find((n) => n.owner === main && n.text === "E3")).toMatchObject({ x: 1152 + Math.floor((192 - 65) / 2), y: 768 + Math.floor((192 - 54) / 2), size: 54 });
  });

  it("labels most cabinets and gives way where a screen's own plate, counters or the logo are", () => {
    const t = target("keynote");
    const count = (mode: CalibrationMode, logo: LogoMode) => texts(frameOf(t.screens, t.width, t.height, mode, logo)).filter((n) => CAB.test(n.text)).length;
    expect({ io: count("identification", "off"), ic: count("identification", "center"), co: count("calibration", "off"), cc: count("calibration", "center") }).toEqual({ io: 117, ic: 125, co: 121, cc: 113 });
  });

  it("are in still frames too, and skipped in cabinets too small to read", () => {
    const t = target("keynote");
    expect(texts(frameOf(t.screens, t.width, t.height, "identification", "off", false)).some((n) => CAB.test(n.text))).toBe(true);
    const tiny: CalibrationScreen = { label: "SCR-01", name: "Tiny", rect: { x: 0, y: 0, width: 320, height: 160 }, canvasX: 0, canvasY: 0, accent: "#4F8DF7", cabinet: { pixelsX: 16, pixelsY: 16, columns: 20, rows: 10 } };
    expect(texts(frameOf([tiny], 320, 160, "calibration", "off")).some((n) => CAB.test(n.text) && n.text !== "SCR")).toBe(false);
  });

  it("where two screens overlap, the larger screen's cabinet labels stay out of the shared area", () => {
    const cabinet = { pixelsX: 128, pixelsY: 128, columns: 8, rows: 4 };
    const big: CalibrationScreen = { label: "SCR-01", name: "Big", rect: { x: 0, y: 0, width: 1024, height: 512 }, canvasX: 0, canvasY: 0, accent: "#4F8DF7", cabinet };
    const small: CalibrationScreen = { label: "SCR-02", name: "Small", rect: { x: 512, y: 256, width: 512, height: 256 }, canvasX: 512, canvasY: 256, accent: "#2BC4B6", cabinet: { ...cabinet, columns: 4, rows: 2 } };
    const f = frameOf([big, small], 1024, 512, "calibration", "off");
    const shared = { x: 512, y: 256, width: 512, height: 256 };
    for (const n of texts(f).filter((x) => x.owner === 0 && CAB.test(x.text))) expect(hits(n, shared), n.text).toBe(false);
  });
});

describe("identification in the stage test card style", () => {
  const t = target("keynote");
  const f = frameOf(t.screens, t.width, t.height, "identification", "off");
  const rect = (x: number, y: number) => f.nodes.filter((n): n is Extract<CalNode, { kind: "rect" }> => n.kind === "rect" && n.x === x && n.y === y);

  it("each cabinet is one of two tones of the screen's color, alternating like a checkerboard", () => {
    t.screens.forEach((s) => {
      for (const cell of cabinetCells(s)) {
        const want = tint(s.accent, (cell.row + cell.column) % 2 === 0 ? CAL_CHECKER.light : CAL_CHECKER.dark);
        expect(rect(cell.box.x, cell.box.y).some((r) => r.width === cell.box.width && r.height === cell.box.height && r.fill === want), `${s.label} ${cabinetLabelText(cell)}`).toBe(true);
      }
    });
  });

  it("keeps the 2 px seams, in black between the tones", () => {
    const main = t.screens[1];
    expect(f.nodes.some((n) => n.kind === "rect" && n.x === main.rect.x + 191 && n.width === 2 && n.height === main.rect.height && n.fill === CAL_COLORS.black)).toBe(true);
  });

  it("cabinet labels pick black or white text, whichever reads on the cabinet's tone", () => {
    for (const color of ["#FFFFFF", "#E8B04A", "#4F8DF7", "#202020"]) {
      for (const share of [CAL_CHECKER.light, CAL_CHECKER.dark]) {
        const bg = tint(color, share);
        const fg = readableOn(bg);
        const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
        const [a, b] = [lum(bg), lum(fg)].sort((p, q) => q - p);
        expect((a + 0.05) / (b + 0.05), `${color} ${share}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("draws corner-to-corner diagonals and two centered circles in whole pixels", () => {
    const d = diagonalRuns({ x: 0, y: 0, width: 768, height: 1536 }, 2, false);
    expect(d).toHaveLength(768);
    expect(d[0]).toMatchObject({ x: 0, y: 0 });
    expect(d.at(-1)!.x + d.at(-1)!.width).toBe(768);
    expect(d.at(-1)!.y + d.at(-1)!.height).toBe(1536);
    const anti = diagonalRuns({ x: 10, y: 0, width: 3000, height: 100 }, 2, true);
    expect(anti[0].x + anti[0].width).toBe(3010);
    expect(anti.at(-1)!.x).toBe(10);
    const ring = ringRuns(500, 500, 100, 2);
    for (const r of ring) for (const n of [r.x, r.y, r.width, r.height]) expect(Number.isSafeInteger(n)).toBe(true);
    expect(Math.min(...ring.map((r) => r.y))).toBe(400);
    expect(Math.max(...ring.map((r) => r.y + r.height))).toBe(600);
    expect(Math.min(...ring.map((r) => r.x))).toBe(400);
  });

  it("center plate: name, W × H resolution and physical size in metres from micrometres, never pitch × pixels", () => {
    expect(metres(16_200_000)).toBe("16.200m");
    expect(metres(9_600_000)).toBe("9.600m");
    expect(metres(500_400)).toBe("0.500m");
    expect(metres(1_234_567)).toBe("1.235m");
    const ident = texts(f).map((n) => n.text);
    expect(ident).toEqual(expect.arrayContaining(["MAIN WALL", "W 2688 x H 1536", "W 7.000m x H 4.000m"]));
    // The plate sits around the screen's center.
    const name = texts(f).find((n) => n.text === "MAIN WALL")!;
    const main = t.screens[1].rect;
    expect(Math.abs(name.x + name.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(2);
  });
});
