import type { ContentFps } from "@/domain/motion";

/**
 * Physical output, pure parts: where an output lands on a display's framebuffer, and how a content
 * frame rate plays on a display's refresh rate. See docs/architecture/PHYSICAL_OUTPUT.md, 8.3 and 8.6.
 *
 * No DOM, no clock: every function depends only on its arguments. Owned by Output Engineering.
 *
 * The types here are local on purpose. They have the same shape as the shared ones in
 * `src/domain/physical-output.ts` (PR #21), so the output page can switch to those once they land.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Pixels on the right and bottom side of the output. */
export interface AxisPx {
  readonly right: number;
  readonly bottom: number;
}

export type SizeMatch = "exact" | "smaller-than-display" | "larger-than-display" | "mixed";

export interface OutputLayoutInput {
  /** The display's framebuffer in device px (`DisplayInfo.devicePx`). */
  readonly devicePx: Size;
  /** `window.devicePixelRatio` in the output window. */
  readonly devicePixelRatio: number;
  /** The `VideoOutput` size, drawn at scale 1. */
  readonly outputPx: Size;
  /** `DisplayInfo.devicePxExact`: false when `devicePx` came from rounding a fractional product. */
  readonly devicePxExact: boolean;
}

export interface OutputLayout {
  /** Canvas backing store: the display's device px, exactly. */
  readonly canvasPx: Size;
  /** Canvas CSS size, `devicePx / devicePixelRatio`, unrounded. */
  readonly canvasCss: { readonly width: string; readonly height: string };
  /** Output px that reach the cable: `min(outputPx, devicePx)` per axis, from the top-left. */
  readonly visiblePx: Size;
  /** Output px past the display edge, never shown. */
  readonly croppedPx: AxisPx;
  /** Display px past the output edge, painted black. */
  readonly blackPx: AxisPx;
  readonly sizeMatch: SizeMatch;
  /** How far, in device px, a measured canvas may differ from `canvasPx` and still count as 1:1. */
  readonly tolerancePx: 0 | 1;
}

function assertSize(name: string, s: Size) {
  if (!Number.isSafeInteger(s.width) || !Number.isSafeInteger(s.height) || s.width < 1 || s.height < 1) {
    throw new RangeError(`${name} must be whole pixels of at least 1 × 1, got ${s.width} × ${s.height}.`);
  }
}

function axisMatch(output: number, display: number): -1 | 0 | 1 {
  return output < display ? -1 : output > display ? 1 : 0;
}

/** Where the output lands on the display. Never scales: the output is drawn 1:1 from the top-left. */
export function outputLayout(input: OutputLayoutInput): OutputLayout {
  const { devicePx, devicePixelRatio: dpr, outputPx } = input;
  assertSize("devicePx", devicePx);
  assertSize("outputPx", outputPx);
  if (!Number.isFinite(dpr) || dpr <= 0) throw new RangeError(`devicePixelRatio must be a positive number, got ${dpr}.`);

  const w = axisMatch(outputPx.width, devicePx.width);
  const h = axisMatch(outputPx.height, devicePx.height);
  const sizeMatch: SizeMatch =
    w === 0 && h === 0 ? "exact" : w <= 0 && h <= 0 ? "smaller-than-display" : w >= 0 && h >= 0 ? "larger-than-display" : "mixed";

  return {
    canvasPx: { width: devicePx.width, height: devicePx.height },
    canvasCss: { width: `${devicePx.width / dpr}px`, height: `${devicePx.height / dpr}px` },
    visiblePx: { width: Math.min(outputPx.width, devicePx.width), height: Math.min(outputPx.height, devicePx.height) },
    croppedPx: { right: Math.max(0, outputPx.width - devicePx.width), bottom: Math.max(0, outputPx.height - devicePx.height) },
    blackPx: { right: Math.max(0, devicePx.width - outputPx.width), bottom: Math.max(0, devicePx.height - outputPx.height) },
    sizeMatch,
    tolerancePx: input.devicePxExact ? 0 : 1,
  };
}

// ── Cadence (8.6) ──────────────────────────────────────────────────────────

/** Longest pattern reported, as the shared `OutputCadence` allows. */
export const MAX_CADENCE_ENTRIES = 240;

/** Tolerance for floating-point time at frame boundaries, in content frames. */
const EPS = 1e-6;

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Refreshes each content frame stays on screen, over one cycle, starting at a refresh that shows frame 0.
 * A 0 means the frame is never shown (content faster than the display).
 *
 * Refresh k shows content frame `floor(k × fps / refreshHz)`. The cycle is exact for whole rates
 * (`fps / gcd(fps, hz)` frames) and one second of content for fractional ones, such as 59.94 Hz.
 * `even` is true only when `refreshHz` is a whole multiple of `fps`.
 * Which entry comes first depends on the phase between the clock and the display, so two patterns that
 * are rotations of each other describe the same cadence.
 */
export function cadencePattern(fps: number, refreshHz: number): { pattern: number[]; even: boolean } {
  if (!Number.isSafeInteger(fps) || fps < 1) throw new RangeError(`fps must be a whole number of at least 1, got ${fps}.`);
  if (!Number.isFinite(refreshHz) || refreshHz <= 0) throw new RangeError(`refreshHz must be a positive number, got ${refreshHz}.`);
  const frames = Math.min(MAX_CADENCE_ENTRIES, Number.isSafeInteger(refreshHz) ? fps / gcd(fps, refreshHz) : fps);
  // First refresh showing frame f: ceil(f × hz / fps).
  const firstRefresh = (f: number) => Math.ceil((f * refreshHz) / fps - EPS);
  const pattern: number[] = [];
  for (let f = 0; f < frames; f++) pattern.push(firstRefresh(f + 1) - firstRefresh(f));
  // Even only when every frame gets the same whole number of refreshes forever. A fractional display rate
  // drifts against whole-number content, so one frame is held short or long every few seconds even when the
  // one-second pattern above looks regular (30 fps on 59.94 Hz: once every 16.7 s).
  const even = Number.isSafeInteger(refreshHz) && refreshHz % fps === 0;
  return { pattern, even };
}

// ── Which content frame (section 4 and 8.6) ───────────────────────────────

/** Same shape as the shared `OutputClock`. `epochMs` is on `performance.timeOrigin + performance.now()`. */
export type OutputClockInput =
  | { readonly state: "playing"; readonly fps: ContentFps; readonly startFrame: number; readonly epochMs: number }
  | { readonly state: "paused"; readonly frame: number };

/** A refresh grid: period `P` in ms and an anchor `t0`, a rAF timestamp on the shared clock. */
export interface RefreshGrid {
  readonly periodMs: number;
  readonly anchorMs: number;
}

/** `t' = t0 + round((t − t0) / P) × P`. Without a usable period, `t` unchanged. */
export function quantizeToRefresh(t: number, grid: RefreshGrid | null): number {
  if (!grid || !Number.isFinite(grid.periodMs) || grid.periodMs <= 0 || !Number.isFinite(grid.anchorMs)) return t;
  return grid.anchorMs + Math.round((t - grid.anchorMs) / grid.periodMs) * grid.periodMs;
}

/** True when `t` has drifted more than a quarter period from the grid: re-anchor at `t`. */
export function needsReanchor(t: number, grid: RefreshGrid): boolean {
  return Math.abs(t - quantizeToRefresh(t, grid)) > grid.periodMs / 4;
}

/**
 * The content frame for a rAF timestamp `t` (ms on the shared clock):
 * `startFrame + floor((t' − epochMs) × fps / 1000)`, with `t'` quantized to the refresh grid.
 * Before the epoch it holds `startFrame`.
 */
export function contentFrame(clock: OutputClockInput, t: number, grid: RefreshGrid | null): number {
  if (clock.state === "paused") return clock.frame;
  const elapsed = quantizeToRefresh(t, grid) - clock.epochMs;
  if (elapsed <= 0) return clock.startFrame;
  return clock.startFrame + Math.floor((elapsed * clock.fps) / 1000 + EPS);
}

/** Median of the intervals between consecutive timestamps, or null with fewer than two. */
export function medianInterval(timestamps: readonly number[]): number | null {
  if (timestamps.length < 2) return null;
  const d = timestamps.slice(1).map((t, i) => t - timestamps[i]).sort((a, b) => a - b);
  const mid = d.length >> 1;
  return d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2;
}
