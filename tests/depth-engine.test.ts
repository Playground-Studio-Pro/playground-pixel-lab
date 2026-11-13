import { describe, expect, it } from "vitest";
import { CONTENT_FPS } from "@/domain/motion";
import { NOMINAL_WINDOW_HEIGHT_M, depthCamera, depthWindow, projectPoint, ringLayout, vanishingPoint, type DepthWindow } from "@/engines/depth/camera";
import { DEPTH_LIMITS, DEPTH_PRESETS, EMERALD_CHAMBER, hexToLinear, loopFrameCount, loopPhase, normalizeDepthConfig } from "@/engines/depth/config";
import { MAX_PARTICLES, PARTICLE_STRIDE, buildParticles, particleState } from "@/engines/depth/particles";
import { MASTER_TARGET_ID, depthTargets, pickDepthTarget } from "@/engines/depth/targets";
import { resolveMapping } from "@/engines/mapping";
import { festivalMainStage } from "./helpers";

describe("depth config", () => {
  it("keeps the Emerald Chamber preset unchanged through validation and JSON", () => {
    expect(normalizeDepthConfig(EMERALD_CHAMBER)).toEqual(EMERALD_CHAMBER);
    expect(normalizeDepthConfig(JSON.parse(JSON.stringify(EMERALD_CHAMBER)))).toEqual(EMERALD_CHAMBER);
    expect(DEPTH_PRESETS[0].config).toBe(EMERALD_CHAMBER);
  });

  it("turns anything into a valid config", () => {
    for (const junk of [null, undefined, 7, "x", [], { room: 3, palette: null, particles: { count: "many" } }]) {
      expect(normalizeDepthConfig(junk)).toEqual(EMERALD_CHAMBER);
    }
  });

  it("clamps numbers to their limits and rejects bad colors and rates", () => {
    const c = normalizeDepthConfig({
      seed: 12.6,
      durationSeconds: 900,
      fps: 29.97,
      room: { depthM: -4, gridOpacity: 9 },
      viewer: { distanceM: 0, offsetXM: 99 },
      particles: { count: 1e9, speed: -1 },
      lighting: { intensity: NaN, directionDeg: 720 },
      palette: { background: "#12345", particle: "#abcdef", accent: "url(javascript:alert(1))" },
    });
    expect(c.seed).toBe(13);
    expect(c.durationSeconds).toBe(DEPTH_LIMITS.durationSeconds.max);
    expect(c.fps).toBe(EMERALD_CHAMBER.fps);
    expect(c.room.depthM).toBe(DEPTH_LIMITS.depthM.min);
    expect(c.room.gridOpacity).toBe(1);
    expect(c.viewer.distanceM).toBe(DEPTH_LIMITS.distanceM.min);
    expect(c.viewer.offsetXM).toBe(DEPTH_LIMITS.offsetXM.max);
    expect(c.particles.count).toBe(MAX_PARTICLES);
    expect(c.particles.speed).toBe(0);
    expect(c.lighting.intensity).toBe(EMERALD_CHAMBER.lighting.intensity);
    expect(c.lighting.directionDeg).toBe(180);
    expect(c.palette).toEqual({ background: EMERALD_CHAMBER.palette.background, particle: "#ABCDEF", accent: EMERALD_CHAMBER.palette.accent });
  });

  it("converts colors to linear light", () => {
    expect(hexToLinear("#000000")).toEqual([0, 0, 0]);
    expect(hexToLinear("#FFFFFF")).toEqual([1, 1, 1]);
    expect(hexToLinear("#808080")[0]).toBeCloseTo(0.2159, 4);
  });
});

describe("depth loop", () => {
  it("has an exact frame count at every content rate", () => {
    for (const fps of CONTENT_FPS) {
      expect(loopFrameCount({ durationSeconds: 15, fps })).toBe(15 * fps);
    }
  });

  it("closes: frame N is frame 0, and no frame inside the loop repeats it", () => {
    for (const fps of CONTENT_FPS) {
      const timing = { durationSeconds: 15, fps };
      const n = loopFrameCount(timing);
      expect(loopPhase(0, timing)).toBe(0);
      expect(loopPhase(n, timing)).toBe(0);
      expect(loopPhase(n + 7, timing)).toBe(loopPhase(7, timing));
      expect(loopPhase(n - 1, timing)).toBeLessThan(1);
      expect(new Set(Array.from({ length: n }, (_, i) => loopPhase(i, timing))).size).toBe(n);
    }
  });
});

describe("depth camera", () => {
  const windows: DepthWindow[] = [
    { widthM: 16 / 3, heightM: 3, calibration: "proportional" },
    { widthM: 12, heightM: 3, calibration: "proportional" },
    { widthM: 2, heightM: 4, calibration: "physical" },
    { widthM: 7.3, heightM: 1.1, calibration: "physical" },
  ];
  const viewers = [
    { distanceM: 8, offsetXM: 0, offsetYM: 0 },
    { distanceM: 3, offsetXM: 4.5, offsetYM: -1.2 },
    { distanceM: 25, offsetXM: -10, offsetYM: 3 },
  ];

  it("lands the LED plane's edges exactly on the image's edges, for any shape and viewer", () => {
    for (const w of windows) {
      for (const viewer of viewers) {
        const camera = depthCamera(w, viewer, 12);
        const at = (x: number, y: number) => projectPoint(camera, [x * w.widthM / 2, y * w.heightM / 2, 0]);
        expect(at(-1, 1).x).toBeCloseTo(0, 9);
        expect(at(-1, 1).y).toBeCloseTo(0, 9);
        expect(at(1, -1).x).toBeCloseTo(1, 9);
        expect(at(1, -1).y).toBeCloseTo(1, 9);
        expect(at(0, 0).x).toBeCloseTo(0.5, 9);
        expect(at(0, 0).y).toBeCloseTo(0.5, 9);
      }
    }
  });

  it("shrinks the back wall by distance over distance plus depth, around the vanishing point", () => {
    for (const w of windows) {
      for (const viewer of viewers) {
        const depth = 12;
        const camera = depthCamera(w, viewer, depth);
        const left = projectPoint(camera, [-w.widthM / 2, 0, -depth]);
        const right = projectPoint(camera, [w.widthM / 2, 0, -depth]);
        expect(right.x - left.x).toBeCloseTo(viewer.distanceM / (viewer.distanceM + depth), 9);
        // A point straight ahead of the eye stays on the vanishing point at any depth.
        const vp = vanishingPoint(w, viewer);
        for (const z of [-0.5, -depth, -200]) {
          const ahead = projectPoint(camera, [viewer.offsetXM, viewer.offsetYM, z]);
          expect(ahead.x).toBeCloseTo(vp.x, 9);
          expect(ahead.y).toBeCloseTo(vp.y, 9);
        }
      }
    }
  });

  it("keeps the whole room inside the clip range", () => {
    const camera = depthCamera(windows[0], viewers[0], 30);
    expect(camera.near).toBeLessThan(viewers[0].distanceM);
    expect(camera.far).toBeGreaterThan(viewers[0].distanceM + 30);
  });

  it("uses the real wall size when it is known, and the aspect ratio when it is not", () => {
    expect(depthWindow({ widthPx: 1920, heightPx: 1080, physical: { widthM: 6, heightM: 3.375 } })).toEqual({ widthM: 6, heightM: 3.375, calibration: "physical" });
    const w = depthWindow({ widthPx: 3840, heightPx: 1080, physical: null });
    expect(w.calibration).toBe("proportional");
    expect(w.heightM).toBe(NOMINAL_WINDOW_HEIGHT_M);
    expect(w.widthM / w.heightM).toBeCloseTo(3840 / 1080, 12);
  });

  it("spaces rings evenly, about two metres apart", () => {
    for (const depth of [2, 5, 12, 30]) {
      const { count, spacingM } = ringLayout(depth);
      expect(count * spacingM).toBeCloseTo(depth, 12);
      expect(count).toBeGreaterThanOrEqual(2);
    }
    expect(ringLayout(12)).toEqual({ count: 6, spacingM: 2 });
  });
});

describe("depth particles", () => {
  const data = buildParticles(1977, 400);
  const circular = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

  it("is decided by the seed alone", () => {
    expect(buildParticles(1977, 400)).toEqual(data);
    expect(buildParticles(1978, 400)).not.toEqual(data);
  });

  it("adds particles without moving the ones already there", () => {
    const more = buildParticles(1977, 900);
    expect(more.slice(0, 400 * PARTICLE_STRIDE)).toEqual(data);
  });

  it("returns every particle to its start at the end of the loop, at any speed", () => {
    for (const speed of [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]) {
      for (let i = 0; i < 400; i++) {
        const a = particleState(data, i, 0, speed);
        const b = particleState(data, i, 1, speed);
        expect(circular(a.x, b.x)).toBeLessThan(1e-9);
        expect(circular(a.y, b.y)).toBeLessThan(1e-9);
        expect(Math.abs(a.z - b.z)).toBeLessThan(1e-9);
        expect(Math.abs(Math.sin(a.angle) - Math.sin(b.angle))).toBeLessThan(1e-9);
        expect(Math.abs(Math.cos(a.angle) - Math.cos(b.angle))).toBeLessThan(1e-9);
      }
    }
  });

  it("stays inside the room and fades out where it wraps", () => {
    for (let i = 0; i < 400; i++) {
      for (const phase of [0, 0.13, 0.5, 0.875]) {
        const s = particleState(data, i, phase, 1);
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThan(1);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThan(1);
        expect(s.z).toBeGreaterThanOrEqual(0.02);
        expect(s.z).toBeLessThanOrEqual(0.98);
        expect(s.fade).toBeGreaterThanOrEqual(0);
        expect(s.fade).toBeLessThanOrEqual(1);
        if (s.x < 1e-6 || s.y < 1e-6) expect(s.fade).toBeLessThan(1e-6);
      }
    }
  });

  it("holds still at speed 0 and moves at speed 1", () => {
    let moved = 0;
    for (let i = 0; i < 400; i++) {
      expect(particleState(data, i, 0.37, 0)).toEqual(particleState(data, i, 0, 0));
      const a = particleState(data, i, 0, 1);
      const b = particleState(data, i, 0.37, 1);
      if (circular(a.x, b.x) > 1e-4 || circular(a.y, b.y) > 1e-4) moved++;
    }
    expect(moved).toBe(400);
  });
});

describe("depth targets", () => {
  const mapping = resolveMapping(festivalMainStage());
  const targets = depthTargets(mapping);

  it("offers the master canvas and every screen, sized by the mapping", () => {
    expect(targets[0]).toMatchObject({ id: MASTER_TARGET_ID, widthPx: mapping.master.width, heightPx: mapping.master.height, physical: null });
    for (const screen of mapping.screens) {
      const t = targets.find((x) => x.id === `screen:${screen.screenId}`)!;
      expect(t.widthPx).toBe(screen.masterRect.width);
      expect(t.heightPx).toBe(screen.masterRect.height);
      expect(t.physical!.widthM).toBeCloseTo(screen.stage.width / 1e6, 12);
      expect(t.physical!.heightM).toBeCloseTo(screen.stage.height / 1e6, 12);
    }
  });

  it("falls back to the first target when the chosen one is gone", () => {
    expect(pickDepthTarget(targets, "screen:deleted")).toBe(targets[0]);
    expect(pickDepthTarget(targets, null)).toBe(targets[0]);
    expect(pickDepthTarget([], MASTER_TARGET_ID)).toBeNull();
  });
});
