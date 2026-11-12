import { describe, expect, it } from "vitest";
import { buildCalibrationFrame, counterText, minorPitch, type CalibrationFrame, type CalibrationInput, type CalibrationMode, type CalibrationScreen, type CalNode, type LogoMode } from "@/components/shell/calibration/frame";
import { calibrationTargets, screenLabel } from "@/components/shell/calibration/from-mapping";
import { CAL_COLORS, CAL_LOGO_ASSET, CAL_MIN_TEXT, screenAccent, tint } from "@/components/shell/calibration/tokens";
import { resolveMapping } from "@/engines/mapping";
import { buildExample } from "@/examples";

const ASPECT = CAL_LOGO_ASSET.width / CAL_LOGO_ASSET.height;
const MODES: CalibrationMode[] = ["identification", "calibration"];
const LOGOS: LogoMode[] = ["center", "watermark", "off"];

type Box = { x: number; y: number; width: number; height: number };
type Label = Extract<CalNode, { kind: "text" | "counter" }>;
const hits = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const labels = (frame: CalibrationFrame) => frame.nodes.filter((n): n is Label => n.kind === "text" || n.kind === "counter");
const rects = (frame: CalibrationFrame) => frame.nodes.filter((n): n is Extract<CalNode, { kind: "rect" }> => n.kind === "rect");
const hasRect = (frame: CalibrationFrame, x: number, y: number, width: number, height: number, fill: string) =>
  rects(frame).some((r) => r.x === x && r.y === y && r.width === width && r.height === height && r.fill === fill);

function keynote(mode: CalibrationMode, logo: LogoMode = "off", elements?: CalibrationInput["elements"]) {
  const [master] = calibrationTargets(resolveMapping(buildExample("keynote")));
  return { master, frame: buildCalibrationFrame({ width: master.width, height: master.height, screens: master.screens, mode, logo: { mode: logo, aspect: ASPECT }, elements, fps: 30 }) };
}

function single(width: number, height: number, mode: CalibrationMode, logo: LogoMode, name = "Stage Left Return Wall"): { frame: CalibrationFrame; screen: CalibrationScreen } {
  const screen: CalibrationScreen = {
    label: "SCR-01",
    name,
    rect: { x: 0, y: 0, width, height },
    canvasX: 12800,
    canvasY: 10240,
    output: { label: "OUT 12", name: "Media server B, port 4" },
    accent: "#4F8DF7",
  };
  return { screen, frame: buildCalibrationFrame({ width, height, screens: [screen], mode, logo: { mode: logo, aspect: ASPECT }, fps: 60 }) };
}

/** The rule the design promises: every label is whole, inside its screen, clear of the logo and of every other label. */
function expectCleanLabels(frame: CalibrationFrame, screens: readonly CalibrationScreen[], context: string) {
  const all = labels(frame);
  const problems: string[] = [];
  const name = (label: Label) => (label.kind === "text" ? label.text : label.field);
  for (const label of all) {
    if (!inside(label, screens[label.owner].rect)) problems.push(`"${name(label)}" leaves its screen`);
    if (label.size < CAL_MIN_TEXT) problems.push(`"${name(label)}" is below the minimum text size`);
    if (frame.logoKeepOut && hits(label, frame.logoKeepOut)) problems.push(`"${name(label)}" covers the logo`);
  }
  // Sweep by x so the 500-screen example doesn't compare every pair.
  const sorted = [...all].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].x < sorted[i].x + sorted[i].width; j++) {
      if (hits(sorted[i], sorted[j])) problems.push(`"${name(sorted[i])}" overlaps "${name(sorted[j])}"`);
    }
  }
  expect(problems, context).toEqual([]);
}

describe("calibration targets", () => {
  it("describes the reference configuration from the resolved mapping", () => {
    const targets = calibrationTargets(resolveMapping(buildExample("keynote")));
    const [master] = targets;
    expect([master.width, master.height, master.space]).toEqual([4224, 1536, "master"]);
    expect(master.screens.map((s) => [s.label, s.name, s.rect.x, s.rect.y, s.rect.width, s.rect.height])).toEqual([
      ["SCR-01", "Left Side", 0, 0, 768, 1536],
      ["SCR-02", "Main Wall", 768, 0, 2688, 1536],
      ["SCR-03", "Right Side", 3456, 0, 768, 1536],
    ]);
    expect(master.screens[1].output).toEqual({ label: "OUT 1", name: "Media server" });
    expect(master.screens[1].cabinet).toEqual({ pixelsX: 192, pixelsY: 192, columns: 14, rows: 8 });
    // One target per output and per screen. A single screen is drawn in its own pixels, from 0, 0,
    // and still reports where it sits on the master canvas.
    expect(targets.map((t) => t.space)).toEqual(["master", "output", "screen", "screen", "screen"]);
    const main = targets[3];
    expect([main.width, main.height, main.screens[0].rect.x, main.screens[0].canvasX]).toEqual([2688, 1536, 0, 768]);
  });

  it("pads identifiers to the number of screens", () => {
    expect(screenLabel(0, 3)).toBe("SCR-01");
    expect(screenLabel(41, 99)).toBe("SCR-42");
    expect(screenLabel(6, 500)).toBe("SCR-007");
  });
});

describe("calibration geometry", () => {
  it("keeps every primitive on whole pixels inside the frame", () => {
    for (const mode of MODES) {
      for (const logo of LOGOS) {
        const { frame } = keynote(mode, logo);
        for (const node of frame.nodes) {
          for (const value of [node.x, node.y, node.width, node.height]) expect(Number.isInteger(value)).toBe(true);
          expect(inside(node, { x: 0, y: 0, width: 4224, height: 1536 })).toBe(true);
          expect(node.width > 0 && node.height > 0).toBe(true);
        }
      }
    }
  });

  it("draws a 1 px white border on the outermost pixels of each screen", () => {
    for (const mode of MODES) {
      const { frame } = keynote(mode);
      // Main Wall: x 768 to 3455, y 0 to 1535.
      expect(hasRect(frame, 768, 0, 2688, 1, CAL_COLORS.white)).toBe(true);
      expect(hasRect(frame, 768, 1535, 2688, 1, CAL_COLORS.white)).toBe(true);
      expect(hasRect(frame, 768, 0, 1, 1536, CAL_COLORS.white)).toBe(true);
      expect(hasRect(frame, 3455, 0, 1, 1536, CAL_COLORS.white)).toBe(true);
    }
  });

  it("centers the crosshair exactly: 2 px across an even dimension, 1 px across an odd one", () => {
    const { frame } = keynote("calibration");
    // Main Wall is 2688 wide from x 768: its middle falls between pixels 2111 and 2112.
    expect(hasRect(frame, 2111, 0, 2, 1536, CAL_COLORS.white)).toBe(true);
    expect(hasRect(frame, 768, 767, 2688, 2, CAL_COLORS.white)).toBe(true);
    // 301 × 201: the middle pixels are 150 and 100.
    const odd = single(301, 201, "calibration", "off").frame;
    expect(hasRect(odd, 150, 0, 1, 201, CAL_COLORS.white)).toBe(true);
    expect(hasRect(odd, 0, 100, 301, 1, CAL_COLORS.white)).toBe(true);
  });

  it("marks cabinet seams with 2 px straddling the seam, and a finer grid inside each cabinet", () => {
    const { frame, master } = keynote("calibration");
    const seam = tint(master.screens[1].accent, 0.62);
    const minor = tint(master.screens[1].accent, 0.3);
    // First seam of Main Wall: between x 959 and 960.
    expect(hasRect(frame, 959, 0, 2, 1536, seam)).toBe(true);
    expect(hasRect(frame, 768, 191, 2688, 2, seam)).toBe(true);
    // 192 px cabinets get a 48 px grid.
    expect(minorPitch(192)).toBe(48);
    expect(hasRect(frame, 768 + 48, 0, 1, 1536, minor)).toBe(true);
    expect(rects(frame).some((r) => r.x === 960 && r.width === 1 && r.height === 1536)).toBe(false);
    expect(minorPitch(50)).toBe(25);
    expect(minorPitch(27)).toBe(27);
    expect(minorPitch(undefined)).toBe(64);
  });

  it("uses exact 8-bit primaries for the reference patches", () => {
    const { frame } = keynote("calibration");
    for (const fill of [CAL_COLORS.red, CAL_COLORS.green, CAL_COLORS.blue]) {
      const patches = rects(frame).filter((r) => r.fill === fill);
      expect(patches).toHaveLength(3);
      for (const patch of patches) expect(patch.width).toBe(patch.height);
    }
    expect([CAL_COLORS.red, CAL_COLORS.green, CAL_COLORS.blue, CAL_COLORS.white, CAL_COLORS.black]).toEqual(["#FF0000", "#00FF00", "#0000FF", "#FFFFFF", "#000000"]);
  });

  it("shows only the elements that are switched on", () => {
    const all = keynote("calibration").frame;
    expect(all.nodes.filter((n) => n.kind === "counter")).toHaveLength(6);
    const bare = keynote("calibration", "off", { grid: false, crosshair: false, references: false, frameCounter: false, metadata: false }).frame;
    expect(bare.nodes.some((n) => n.kind === "counter")).toBe(false);
    expect(rects(bare).some((r) => r.fill === CAL_COLORS.red)).toBe(false);
    expect(hasRect(bare, 2111, 0, 2, 1536, CAL_COLORS.white)).toBe(false);
    // Identifier, name and the orientation label stay: a screen is always identifiable.
    expect(labels(bare).map((l) => (l.kind === "text" ? l.text : ""))).toEqual(expect.arrayContaining(["SCR-02", "MAIN WALL", "TOP"]));
    expect(hasRect(bare, 768, 0, 2688, 1, CAL_COLORS.white)).toBe(true);
  });

  it("builds the same frame from the same input", () => {
    expect(keynote("calibration", "center").frame).toEqual(keynote("calibration", "center").frame);
  });
});

describe("calibration labels", () => {
  it("carries identifier, name, resolution, canvas coordinates and output in both modes", () => {
    for (const mode of MODES) {
      const { frame } = keynote(mode, "center");
      const texts = labels(frame).flatMap((l) => (l.kind === "text" ? [l.text] : []));
      expect(texts).toEqual(expect.arrayContaining(["SCR-01", "SCR-02", "SCR-03", "LEFT SIDE", "MAIN WALL", "RIGHT SIDE", "2688 × 1536 PX", "768 × 1536 PX", "X 768  Y 0", "X 3456  Y 0", "OUT 1 · MEDIA SERVER", "TOP"]));
    }
    // Calibration adds the last pixel of each screen on the master canvas.
    const texts = labels(keynote("calibration").frame).flatMap((l) => (l.kind === "text" ? [l.text] : []));
    expect(texts).toEqual(expect.arrayContaining(["X 3455  Y 1535", "X 4223  Y 1535", "CAB 14 × 8 · 192 × 192 PX", "GRID 48 PX", "CONTENT 30 FPS"]));
  });

  it("never clips or overlaps a label on the reference configuration", () => {
    for (const mode of MODES) {
      for (const logo of LOGOS) {
        const { frame, master } = keynote(mode, logo);
        expectCleanLabels(frame, master.screens, `keynote ${mode} ${logo}`);
      }
    }
  });

  it("never clips or overlaps a label at any screen shape", () => {
    const sizes: [number, number][] = [
      [768, 1536], [2688, 1536], [96, 1024], [128, 2160], [3840, 216], [7680, 128], [5000, 100], [192, 192], [64, 64], [31, 77], [24, 24], [8, 8], [1, 1], [1920, 1080], [301, 201], [160, 600], [400, 90],
    ];
    for (const [width, height] of sizes) {
      for (const mode of MODES) {
        for (const logo of LOGOS) {
          const { frame, screen } = single(width, height, mode, logo);
          expectCleanLabels(frame, [screen], `${width}×${height} ${mode} ${logo}`);
        }
      }
    }
  });

  it("never clips or overlaps a label in any example, on the master, each output and each screen", () => {
    for (const id of ["festival", "keynote", "motion-lab", "stress-500"] as const) {
      const targets = calibrationTargets(resolveMapping(buildExample(id)));
      // The stress test repeats one screen 500 times: its master and first screens cover it.
      for (const target of id === "stress-500" ? targets.slice(0, 4) : targets) {
        for (const mode of MODES) {
          const frame = buildCalibrationFrame({ width: target.width, height: target.height, screens: target.screens, mode, logo: { mode: "center", aspect: ASPECT }, fps: 25 });
          expectCleanLabels(frame, target.screens, `${id} ${target.label} ${mode}`);
        }
      }
    }
  });

  it("keeps the identifier on screen as long as there's room for readable text", () => {
    // A narrow portrait screen and a low ribbon both keep their identifier.
    for (const [width, height] of [[96, 1024], [3840, 216], [192, 192], [64, 64]] as const) {
      for (const mode of MODES) {
        const texts = labels(single(width, height, mode, "off").frame).flatMap((l) => (l.kind === "text" ? [l.text] : []));
        expect(texts, `${width}×${height} ${mode}`).toContain("SCR-01");
      }
    }
    // Long names are shortened with an ellipsis, never cut by the screen edge.
    const texts = labels(single(160, 600, "identification", "off").frame).flatMap((l) => (l.kind === "text" ? [l.text] : []));
    expect(texts.some((t) => t.endsWith("…"))).toBe(true);
  });

  it("keeps every identifier where screens share pixels, in both modes", () => {
    // Festival: the Header sits on the top band of the Center Wall, so the wall's own corner is covered.
    const [master] = calibrationTargets(resolveMapping(buildExample("festival")));
    for (const mode of MODES) {
      const frame = buildCalibrationFrame({ width: master.width, height: master.height, screens: master.screens, mode, logo: { mode: "off", aspect: ASPECT }, fps: 30 });
      const texts = labels(frame).flatMap((l) => (l.kind === "text" ? [l.text] : []));
      expect(texts, mode).toEqual(expect.arrayContaining(master.screens.map((s) => s.label)));
      // The smaller screen owns the shared band: none of the wall's labels are in it.
      const wall = master.screens.findIndex((s) => s.name === "Center Wall");
      const header = master.screens.find((s) => s.name === "Header")!;
      expect(labels(frame).filter((l) => l.owner === wall).some((l) => hits(l, header.rect)), mode).toBe(false);
    }
  });

  it("gives counters a fixed box, so playback never moves the layout", () => {
    expect(counterText("frame", 0, 30)).toBe("F 000000");
    expect(counterText("frame", 123, 30)).toBe("F 000123");
    expect(counterText("frame", 1_000_007, 30)).toBe("F 000007");
    expect(counterText("timecode", 123, 30)).toBe("00:00:04:03");
    const counters = keynote("calibration").frame.nodes.filter((n): n is Extract<CalNode, { kind: "counter" }> => n.kind === "counter");
    for (const node of counters) {
      // Width is the monospace advance of the counter's fixed length: 0.6 of the size per character.
      expect(node.width).toBe(Math.ceil(counterText(node.field, 0, 30).length * node.size * 0.6));
    }
  });
});

describe("calibration logo", () => {
  it("centers the logo on the output and keeps its aspect ratio", () => {
    for (const [width, height] of [[4224, 1536], [768, 1536], [1920, 1080], [3840, 216]] as const) {
      for (const mode of ["center", "watermark"] as const) {
        const { frame } = single(width, height, "identification", mode);
        const logo = frame.nodes.find((n) => n.kind === "logo")!;
        expect(logo, `${width}×${height} ${mode}`).toBeDefined();
        // Within half a pixel of the file's own ratio, on either side.
        expect(Math.abs(logo.width - logo.height * ASPECT)).toBeLessThanOrEqual(ASPECT / 2 + 0.5);
        expect(logo.x).toBe(Math.floor((width - logo.width) / 2));
        expect(logo.y).toBe(Math.floor((height - logo.height) / 2));
        expect(inside(logo, { x: 0, y: 0, width, height })).toBe(true);
      }
    }
  });

  it("is 18% of the short side when centered, a faint half when a watermark, and absent when off", () => {
    const center = keynote("identification", "center").frame;
    const logo = center.nodes.find((n) => n.kind === "logo")!;
    // 1536 × 0.18 = 276.48 → 276 high; 276 × 2000 / 624 = 884.6 → 885 wide; centered on 4224 × 1536.
    expect(logo).toMatchObject({ x: 1669, y: 630, width: 885, height: 276, opacity: 1 });
    expect(center.logoKeepOut).toEqual({ x: 1600, y: 561, width: 1023, height: 414 });

    const watermark = keynote("identification", "watermark").frame;
    expect(watermark.nodes.find((n) => n.kind === "logo")).toMatchObject({ height: 768, opacity: 0.08 });
    expect(watermark.logoKeepOut).toBeNull();

    const off = keynote("identification", "off").frame;
    expect(off.nodes.some((n) => n.kind === "logo")).toBe(false);
  });
});

describe("calibration tokens", () => {
  it("mixes solid tints over black", () => {
    expect(tint("#FFFFFF", 0.5)).toBe("#808080");
    expect(tint("#2F6FE4", 0)).toBe("#000000");
    expect(tint("#804020", 1)).toBe("#804020");
  });

  it("lifts dark screen colors until they read on a dark field, and leaves bright ones alone", () => {
    expect(screenAccent("#FFFFFF", 0)).toBe("#FFFFFF");
    expect(screenAccent("#3EC1E3", 0)).toBe("#3EC1E3");
    const lifted = screenAccent("#101020", 0);
    expect(lifted).not.toBe("#101020");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(lifted.slice(i, i + 2), 16));
    expect(Math.max(r, g, b)).toBeGreaterThan(120);
    // An unreadable value falls back to the accent palette by index.
    expect(screenAccent("not a color", 1)).toBe("#2BC4B6");
  });
});
