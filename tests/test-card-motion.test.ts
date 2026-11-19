import { describe, expect, it } from "vitest";
import { drawCalibration } from "@/components/shell/calibration/draw";
import { buildCalibrationFrame, sweepFor, sweepLeft, sweepRects, type CalibrationFrame, type CalibrationMode, type CalNode, type LogoMode } from "@/components/shell/calibration/frame";
import { calibrationTargets } from "@/components/shell/calibration/from-mapping";
import { CAL_LOGO_ASSET, CAL_SWEEP } from "@/components/shell/calibration/tokens";
import { CONTENT_FPS } from "@/domain/motion";
import { resolveMapping } from "@/engines/mapping";
import { buildExample } from "@/examples";
import { calibrationFrameFor } from "@/modules/output/calibration-source";
import type { FrameInput } from "@/preview/contract";

const ASPECT = CAL_LOGO_ASSET.width / CAL_LOGO_ASSET.height;
const EXPORT_SECONDS = [5, 10, 15, 20, 30, 60];
type Box = { x: number; y: number; width: number; height: number };
type Label = Extract<CalNode, { kind: "text" | "counter" }>;
const hits = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function master(example: "keynote" | "festival") {
  const project = buildExample(example);
  const mapping = resolveMapping(project);
  return { project, mapping, target: calibrationTargets(mapping)[0] };
}
const build = (example: "keynote" | "festival", mode: CalibrationMode, logo: LogoMode, motion: boolean) => {
  const { target } = master(example);
  return buildCalibrationFrame({ width: target.width, height: target.height, screens: target.screens, mode, logo: { mode: logo, aspect: ASPECT }, fps: 30, motion });
};

/** Records fillRect calls, to compare what two frames draw. */
function rectsDrawn(frame: CalibrationFrame, n: number) {
  const calls: number[][] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : (...a: number[]) => void (k === "fillRect" && calls.push(a))),
    set: (t, k, v) => ((t[k as string] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  drawCalibration(ctx, frame, { scale: 1, fontFamily: "monospace", logo: null, frame: n, fps: 30 }, "static");
  return calls;
}

describe("sweep bar (moving test card)", () => {
  it("crosses the master in even whole-pixel steps and repeats every period", () => {
    for (const fps of CONTENT_FPS) {
      for (const width of [1920, 1000, 7680, 641]) {
        const s = sweepFor(width, fps, [{ x: 0, y: 0, width, height: 10 }]);
        expect(s.period).toBe(CAL_SWEEP.seconds * fps);
        expect(s.barWidth % 2).toBe(0);
        const lo = Math.floor(width / s.period);
        for (let f = 0; f < s.period; f++) {
          const step = (f + 1 === s.period ? width : sweepLeft(s, f + 1)) - sweepLeft(s, f);
          expect(step === lo || step === lo + 1, `${width}@${fps} f${f}: ${step}`).toBe(true);
          // Always visible, always the full bar width (split across the wrap if needed).
          expect(sweepRects(s, f).reduce((n, r) => n + r.width, 0)).toBe(s.barWidth);
        }
        for (const f of [0, 1, 17, s.period - 1]) expect(sweepRects(s, f + s.period)).toEqual(sweepRects(s, f));
      }
    }
  });

  it("the period divides every export duration at every content rate, so the last frame leads into frame 0", () => {
    for (const fps of CONTENT_FPS) {
      const s = sweepFor(3072, fps, [{ x: 0, y: 0, width: 3072, height: 100 }]);
      for (const seconds of EXPORT_SECONDS) {
        const frames = seconds * fps;
        expect(frames % s.period).toBe(0);
        // The frame after the file's last frame is the file's first frame.
        expect(sweepRects(s, frames)).toEqual(sweepRects(s, 0));
      }
    }
  });

  it("crosses the whole master, wraps at the right edge, and stays inside the screens", () => {
    const { target } = master("keynote");
    const s = sweepFor(target.width, 30, target.screens.map((x) => x.rect));
    const lefts = new Set<number>();
    for (let f = 0; f < s.period; f++) {
      for (const r of sweepRects(s, f)) {
        expect(target.screens.some((x) => r.x >= x.rect.x && r.x + r.width <= x.rect.x + x.rect.width && r.y === x.rect.y && r.height === x.rect.height)).toBe(true);
        lefts.add(r.x);
      }
    }
    expect(Math.min(...lefts)).toBe(target.screens.reduce((m, x) => Math.min(m, x.rect.x), Infinity));
    // The last frame's bar runs past the right edge and wraps to x = 0.
    const full = { ...s, areas: [{ x: 0, y: 0, width: s.width, height: 1 }] };
    expect(sweepRects(full, s.period - 1).some((r) => r.x === 0) || sweepLeft(full, s.period - 1) + s.barWidth <= s.width).toBe(true);
    expect(sweepLeft(full, 0)).toBe(0);
  });

  it("frame 0 and frame N draw the bar in different places; the same frame draws the same", () => {
    const frame = build("keynote", "identification", "center", true);
    expect(rectsDrawn(frame, 0)).not.toEqual(rectsDrawn(frame, 45));
    expect(rectsDrawn(frame, 45)).toEqual(rectsDrawn(frame, 45));
    expect(rectsDrawn(frame, 45 + frame.sweep!.period)).toEqual(rectsDrawn(frame, 45));
  });

  it("goes under every label plate, mark, logo and text: drawn after the field and grid only", () => {
    for (const mode of ["identification", "calibration"] as const) {
      for (const logo of ["center", "watermark", "off"] as const) {
        const frame = build("keynote", mode, logo, true);
        // Everything that isn't a plain rectangle (labels, counters, logo) comes after the sweep, and so do the
        // label plates, which are drawn after the field and grid.
        for (const [i, n] of frame.nodes.entries()) if (n.kind !== "rect") expect(i, `${mode}/${logo} ${n.kind}`).toBeGreaterThanOrEqual(frame.sweep!.before);
      }
    }
  });
});

describe("counters in identification", () => {
  it("a moving card shows frame and timecode on every large screen, clear of every other label", () => {
    for (const example of ["keynote", "festival"] as const) {
      const frame = build(example, "identification", "center", true);
      const counters = frame.nodes.filter((n) => n.kind === "counter");
      expect(counters.some((n) => n.kind === "counter" && n.field === "frame")).toBe(true);
      expect(counters.some((n) => n.kind === "counter" && n.field === "timecode")).toBe(true);
      const labels = frame.nodes.filter((n): n is Label => n.kind === "text" || n.kind === "counter");
      for (const c of counters) for (const l of labels) if (l !== c) expect(hits(c as Label, l), `${example}`).toBe(false);
      if (frame.logoKeepOut) for (const c of counters) expect(hits(c as Label, frame.logoKeepOut)).toBe(false);
    }
  });

  it("a still frame (the Preview dialog's PNG) is unchanged: no counters in identification, no sweep", () => {
    const frame = build("keynote", "identification", "center", false);
    expect(frame.nodes.some((n) => n.kind === "counter")).toBe(false);
    expect(frame.sweep).toBeNull();
  });

  it("the output test card source is a moving card", () => {
    const { project, mapping } = master("keynote");
    const input: FrameInput = { frame: 0, fps: 30, width: mapping.master.width, height: mapping.master.height, screens: mapping.screens.map((s) => ({ id: s.screenId, name: s.name, ...s.masterRect })), context: { project, mapping } };
    for (const mode of ["identification", "calibration"] as const) {
      const frame = calibrationFrameFor(input, { mode, logo: "center" });
      expect(frame.sweep).not.toBeNull();
      expect(frame.nodes.some((n) => n.kind === "counter")).toBe(true);
    }
  });
});
