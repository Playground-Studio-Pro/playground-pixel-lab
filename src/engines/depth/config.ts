import { CONTENT_FPS, type ContentFps } from "@/domain/motion";

/**
 * Depth Studio scene configuration: everything that decides what a depth scene looks like.
 *
 * Pure and serializable. The render target (which canvas or screen, and its pixel size) is not part of
 * it: that stays owned by the mapping, and a scene only refers to it. See `targets.ts`.
 *
 * Lengths are metres in the virtual room, as plain numbers. They describe a picture, not the physical
 * wall, so the integer-micrometre rule for stage lengths doesn't apply to them.
 */

export const DEPTH_CONFIG_VERSION = 1;

export type DepthSceneId = "infinite-particle-room";

export interface DepthSceneConfig {
  readonly version: typeof DEPTH_CONFIG_VERSION;
  readonly sceneId: DepthSceneId;
  /** Decides every particle. The same seed always gives the same particles. */
  readonly seed: number;
  /** Loop length in whole seconds, so the frame count is exact at every content rate. */
  readonly durationSeconds: number;
  readonly fps: ContentFps;
  readonly room: {
    /** How far the room extends behind the LED plane. */
    readonly depthM: number;
    readonly showGrid: boolean;
    readonly gridOpacity: number;
  };
  /** The eye the picture is correct for, measured from the centre of the LED plane. */
  readonly viewer: {
    readonly distanceM: number;
    /** Positive is to the viewer's right. */
    readonly offsetXM: number;
    /** Positive is up. */
    readonly offsetYM: number;
  };
  readonly particles: {
    readonly enabled: boolean;
    readonly count: number;
    /** 0 holds every particle still. Motion always closes the loop, at any speed. */
    readonly speed: number;
    readonly size: number;
    readonly opacity: number;
  };
  readonly lighting: {
    readonly intensity: number;
    /** Direction the light sweep travels: 0 is left to right, 90 is front to back. */
    readonly directionDeg: number;
    /** Width of the sweep, as a fraction of the distance it crosses. */
    readonly sweepWidth: number;
  };
  readonly atmosphere: {
    /** Fog per metre of room. */
    readonly fogDensity: number;
  };
  /** `#RRGGBB`. */
  readonly palette: {
    readonly background: string;
    readonly particle: string;
    readonly accent: string;
  };
}

export interface NumberLimit {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const DEPTH_LIMITS = {
  seed: { min: 0, max: 999_999, step: 1 },
  durationSeconds: { min: 5, max: 60, step: 1 },
  depthM: { min: 2, max: 30, step: 0.5 },
  gridOpacity: { min: 0, max: 1, step: 0.05 },
  distanceM: { min: 2, max: 30, step: 0.5 },
  offsetXM: { min: -10, max: 10, step: 0.1 },
  offsetYM: { min: -3, max: 3, step: 0.1 },
  count: { min: 0, max: 5000, step: 50 },
  speed: { min: 0, max: 2, step: 0.25 },
  size: { min: 0.4, max: 2.5, step: 0.1 },
  opacity: { min: 0, max: 1, step: 0.05 },
  intensity: { min: 0, max: 2, step: 0.05 },
  directionDeg: { min: -180, max: 180, step: 5 },
  sweepWidth: { min: 0.05, max: 0.5, step: 0.01 },
  fogDensity: { min: 0, max: 0.2, step: 0.005 },
} as const satisfies Record<string, NumberLimit>;

export interface DepthPreset {
  readonly id: string;
  readonly name: string;
  readonly config: DepthSceneConfig;
}

export const EMERALD_CHAMBER: DepthSceneConfig = {
  version: DEPTH_CONFIG_VERSION,
  sceneId: "infinite-particle-room",
  seed: 1977,
  durationSeconds: 15,
  fps: 30,
  room: { depthM: 12, showGrid: true, gridOpacity: 0.35 },
  viewer: { distanceM: 8, offsetXM: 0, offsetYM: 0 },
  particles: { enabled: true, count: 1500, speed: 1, size: 1, opacity: 0.8 },
  lighting: { intensity: 1, directionDeg: 0, sweepWidth: 0.18 },
  atmosphere: { fogDensity: 0.045 },
  palette: { background: "#04140E", particle: "#5FD08C", accent: "#DDF3E8" },
};

export const DEPTH_PRESETS: readonly DepthPreset[] = [{ id: "emerald-chamber", name: "Emerald Chamber", config: EMERALD_CHAMBER }];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** `#RRGGBB` to linear-light RGB, 0 to 1. */
export function hexToLinear(hex: string): [number, number, number] {
  const channel = (i: number) => {
    const s = parseInt(hex.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
}

function num(value: unknown, limit: NumberLimit, fallback: number, whole = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(limit.max, Math.max(limit.min, value));
  return whole ? Math.round(clamped) : clamped;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Makes any input a valid config: numbers are clamped to `DEPTH_LIMITS`, and anything missing or of the
 * wrong type takes the Emerald Chamber value. Used for every config that comes from outside the editor.
 */
export function normalizeDepthConfig(input: unknown): DepthSceneConfig {
  const d = EMERALD_CHAMBER;
  const src = record(input);
  const room = record(src.room);
  const viewer = record(src.viewer);
  const particles = record(src.particles);
  const lighting = record(src.lighting);
  const atmosphere = record(src.atmosphere);
  const palette = record(src.palette);
  const L = DEPTH_LIMITS;
  const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  const hex = (value: unknown, fallback: string) => (isHexColor(value) ? value.toUpperCase() : fallback);
  return {
    version: DEPTH_CONFIG_VERSION,
    sceneId: "infinite-particle-room",
    seed: num(src.seed, L.seed, d.seed, true),
    durationSeconds: num(src.durationSeconds, L.durationSeconds, d.durationSeconds, true),
    fps: (CONTENT_FPS as readonly unknown[]).includes(src.fps) ? (src.fps as ContentFps) : d.fps,
    room: {
      depthM: num(room.depthM, L.depthM, d.room.depthM),
      showGrid: bool(room.showGrid, d.room.showGrid),
      gridOpacity: num(room.gridOpacity, L.gridOpacity, d.room.gridOpacity),
    },
    viewer: {
      distanceM: num(viewer.distanceM, L.distanceM, d.viewer.distanceM),
      offsetXM: num(viewer.offsetXM, L.offsetXM, d.viewer.offsetXM),
      offsetYM: num(viewer.offsetYM, L.offsetYM, d.viewer.offsetYM),
    },
    particles: {
      enabled: bool(particles.enabled, d.particles.enabled),
      count: num(particles.count, L.count, d.particles.count, true),
      speed: num(particles.speed, L.speed, d.particles.speed),
      size: num(particles.size, L.size, d.particles.size),
      opacity: num(particles.opacity, L.opacity, d.particles.opacity),
    },
    lighting: {
      intensity: num(lighting.intensity, L.intensity, d.lighting.intensity),
      directionDeg: num(lighting.directionDeg, L.directionDeg, d.lighting.directionDeg),
      sweepWidth: num(lighting.sweepWidth, L.sweepWidth, d.lighting.sweepWidth),
    },
    atmosphere: { fogDensity: num(atmosphere.fogDensity, L.fogDensity, d.atmosphere.fogDensity) },
    palette: {
      background: hex(palette.background, d.palette.background),
      particle: hex(palette.particle, d.palette.particle),
      accent: hex(palette.accent, d.palette.accent),
    },
  };
}

/** Frames in one loop. Whole seconds × whole frames per second, so it's exact. */
export function loopFrameCount(config: Pick<DepthSceneConfig, "durationSeconds" | "fps">): number {
  return config.durationSeconds * config.fps;
}

/**
 * Where a frame sits in the loop, 0 up to but not including 1. Frame N lands on 0 again, so a loop of
 * N frames never holds a duplicate of its first frame.
 */
export function loopPhase(frame: number, config: Pick<DepthSceneConfig, "durationSeconds" | "fps">): number {
  const count = loopFrameCount(config);
  return (((frame % count) + count) % count) / count;
}
