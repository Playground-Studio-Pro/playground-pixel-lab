import { describe, expect, it } from "vitest";
import { CONTENT_FPS, PATTERNS, type MotionScreen } from "@/domain/motion";
import {
  AURORA_DIRECTIONS,
  AURORA_LOOP_S,
  AURORA_PRESETS,
  AURORA_SPEEDS,
  DEFAULT_AURORA,
  auroraGradient,
  auroraPalette,
  auroraPhase,
  sampleAurora,
  type AuroraSettings,
} from "@/engines/content/aurora";
import { resolveMapping } from "@/engines/mapping";
import { renderPattern } from "@/engines/motion/patterns";
import { previewRegions } from "@/engines/motion/regions";
import { buildViewModel } from "@/state/view-model";
import { festivalMainStage } from "./helpers";

const project = festivalMainStage();
const mapping = resolveMapping(project);
const screens: MotionScreen[] = mapping.screens.map((s) => ({ id: s.screenId, name: s.name, x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height }));
const W = mapping.master.width;
const H = mapping.master.height;
const input = (frame: number, fps: (typeof CONTENT_FPS)[number] = 30) => ({ frame, fps, width: W, height: H, screens });

/** Largest per-channel difference between two colors. */
const delta = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

describe("Aurora Gradient: fixture", () => {
  it("uses Festival Main Stage's 5120 × 1664 master", () => {
    expect([W, H]).toEqual([5120, 1664]);
    expect(screens.length).toBeGreaterThan(3);
  });

  it("is listed in the Live preview pattern selector and reached through renderPattern", () => {
    expect(PATTERNS.map((p) => p.id)).toContain("aurora");
    expect(renderPattern("aurora", input(42))).toEqual(auroraGradient(input(42), DEFAULT_AURORA));
    const custom: AuroraSettings = { colors: ["#FF0000", "#00FF00"], speed: 2, direction: 90 };
    expect(renderPattern("aurora", input(42), { aurora: custom })).toEqual(auroraGradient(input(42), custom));
  });
});

describe("Aurora Gradient: determinism", () => {
  it("gives the same frame for the same frame number and settings", () => {
    for (const frame of [0, 1, 299, 12_345]) {
      expect(auroraGradient(input(frame))).toEqual(auroraGradient(input(frame)));
    }
  });

  it("depends on content time, not on content FPS", () => {
    // Frame 75 at 25 fps, frame 90 at 30 fps and frame 180 at 60 fps are all 3 s into the content.
    const at = (fps: (typeof CONTENT_FPS)[number]) => auroraGradient(input(3 * fps, fps));
    for (const fps of CONTENT_FPS) expect(at(fps)).toEqual(at(30));
  });

  it("moves from one frame to the next", () => {
    expect(auroraGradient(input(1))).not.toEqual(auroraGradient(input(0)));
  });

  it.each(AURORA_SPEEDS)("loops exactly every %s× speed period", (speed) => {
    const settings = { ...DEFAULT_AURORA, speed };
    const loop = (AURORA_LOOP_S / speed) * 30;
    expect(auroraGradient(input(loop), settings)).toEqual(auroraGradient(input(0), settings));
    expect(auroraGradient(input(loop + 7), settings)).toEqual(auroraGradient(input(7), settings));
    expect(auroraPhase(loop / 2, 30, speed)).toBe(0.5);
  });

  it("doesn't depend on how screens are arranged", () => {
    const moved = screens.map((s) => ({ ...s, x: s.x + 64, y: s.y + 8 }));
    expect(auroraGradient({ ...input(40), screens: moved })).toEqual(auroraGradient(input(40)));
    expect(auroraGradient({ ...input(40), screens: [] })).toEqual(auroraGradient(input(40)));
  });

  it("produces only finite numbers for every direction and speed", () => {
    for (const direction of AURORA_DIRECTIONS) {
      for (const speed of AURORA_SPEEDS) {
        const json = JSON.stringify(auroraGradient(input(777), { ...DEFAULT_AURORA, direction, speed }));
        expect(json).not.toMatch(/null|NaN|Infinity/);
      }
    }
  });
});

describe("Aurora Gradient: settings", () => {
  it("uses the chosen colors", () => {
    const frame = auroraGradient(input(0), { ...DEFAULT_AURORA, colors: ["#FF0000", "#0000FF"] });
    const glowColors = new Set(frame.primitives.filter((p) => p.kind === "glow").map((p) => p.stops[0][1]));
    expect(glowColors).toEqual(new Set(["rgba(255,0,0,0.62)", "rgba(0,0,255,0.62)"]));
  });

  it("falls back to the default palette when colors are invalid or too few", () => {
    expect(auroraPalette(["#FF0000"])).toEqual(DEFAULT_AURORA.colors);
    expect(auroraPalette(["red", "#12345"])).toEqual(DEFAULT_AURORA.colors);
    expect(auroraPalette(["#FF0000", "nope", "#00FF00"])).toEqual(["#FF0000", "#00FF00"]);
  });

  it("travels in the chosen direction", () => {
    // The base gradient runs along the direction of travel.
    for (const direction of AURORA_DIRECTIONS) {
      const linear = auroraGradient(input(0), { ...DEFAULT_AURORA, direction }).primitives[0];
      if (linear.kind !== "linear") throw new Error("expected the base gradient first");
      const angle = (Math.atan2(linear.to[1] - linear.from[1], linear.to[0] - linear.from[0]) * 180) / Math.PI;
      expect(((Math.round(angle) % 360) + 360) % 360).toBe(direction);
    }
  });

  it("moves faster at a higher speed", () => {
    expect(auroraPhase(30, 30, 2)).toBe(2 * auroraPhase(30, 30, 1));
  });

  it("ships valid presets", () => {
    for (const p of AURORA_PRESETS) expect(auroraPalette(p.colors)).toEqual(p.colors);
  });
});

describe("Aurora Gradient: continuity across Festival Main Stage", () => {
  /** Pairs of screens that touch edge to edge on the master, with the shared span along the seam. */
  function seams() {
    const out: { a: MotionScreen; b: MotionScreen; axis: "x" | "y"; at: number; from: number; to: number }[] = [];
    for (const a of screens) {
      for (const b of screens) {
        if (a === b) continue;
        const from = Math.max(a.y, b.y);
        const to = Math.min(a.y + a.height, b.y + b.height);
        if (a.x + a.width === b.x && to > from) out.push({ a, b, axis: "x", at: b.x, from, to });
        const fromX = Math.max(a.x, b.x);
        const toX = Math.min(a.x + a.width, b.x + b.width);
        if (a.y + a.height === b.y && toX > fromX) out.push({ a, b, axis: "y", at: b.y, from: fromX, to: toX });
      }
    }
    return out;
  }

  it("has screens that touch on the master", () => {
    expect(seams().length).toBeGreaterThan(0);
  });

  it.each([0, 137, 451])("changes no more across a screen seam than between neighbouring pixels inside a screen (frame %i)", (frameNo) => {
    for (const direction of [0, 45, 90, 180] as const) {
      const frame = auroraGradient(input(frameNo), { ...DEFAULT_AURORA, direction });
      // Largest step between neighbouring master pixels anywhere on a coarse lattice: the field's own smoothness.
      let inner = 0;
      for (let x = 1; x < W - 1; x += 97) {
        for (let y = 1; y < H - 1; y += 89) {
          inner = Math.max(inner, delta(sampleAurora(frame, x, y), sampleAurora(frame, x + 1, y)), delta(sampleAurora(frame, x, y), sampleAurora(frame, x, y + 1)));
        }
      }
      expect(inner).toBeLessThan(4);
      for (const seam of seams()) {
        for (let t = seam.from; t < seam.to; t += 16) {
          const before = seam.axis === "x" ? sampleAurora(frame, seam.at - 1, t) : sampleAurora(frame, t, seam.at - 1);
          const after = seam.axis === "x" ? sampleAurora(frame, seam.at, t) : sampleAurora(frame, t, seam.at);
          expect(delta(before, after)).toBeLessThan(4);
        }
      }
    }
  });

  it("slices every screen straight from its master region, so content runs on across seams", () => {
    // The preview cuts each screen from the one master image by its masterRect: seams above are what screens show.
    const model = buildViewModel(project, mapping, "content", null);
    const regions = previewRegions(model.items, mapping);
    expect(regions.length).toBe(mapping.screens.length);
    for (const r of regions) {
      const s = mapping.screens.find((m) => m.screenId === r.screenId)!;
      expect(r.source).toEqual(s.masterRect);
    }
  });

  it("lights the whole master: no screen falls on unpainted night", () => {
    const frame = auroraGradient(input(90));
    for (const s of screens) {
      const [r, g, b] = sampleAurora(frame, s.x + Math.floor(s.width / 2), s.y + Math.floor(s.height / 2));
      expect(r + g + b).toBeGreaterThan(60);
    }
  });
});
