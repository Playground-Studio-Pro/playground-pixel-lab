import type { ContentFps, MotionScreen, PatternId } from "@/domain/motion";
import { timecode } from "./clock";

/**
 * Procedural test patterns, described as drawing primitives in master canvas pixels.
 *
 * Pure and deterministic: the description depends only on the frame number, the content FPS, the
 * master size and the screens. Content is defined once over the whole master canvas, so it
 * continues across screen boundaries by construction, and shared regions read the same pixels.
 */

export type Stop = readonly [offset: number, color: string];

export type Primitive =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: string }
  /** A rectangle filled with a linear gradient running from `from` to `to`. */
  | {
      readonly kind: "linear";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly from: readonly [number, number];
      readonly to: readonly [number, number];
      readonly stops: readonly Stop[];
    }
  /** A radial glow, blended additively so overlapping glows brighten. */
  | { readonly kind: "glow"; readonly cx: number; readonly cy: number; readonly r: number; readonly stops: readonly Stop[] }
  /** Straight lines across the whole master, at the given positions on one axis. */
  | { readonly kind: "lines"; readonly axis: "x" | "y"; readonly at: readonly number[]; readonly width: number; readonly color: string }
  /** A stroked polyline, as x, y pairs. */
  | { readonly kind: "path"; readonly points: readonly number[]; readonly width: number; readonly color: string }
  | {
      readonly kind: "text";
      readonly x: number;
      readonly y: number;
      readonly text: string;
      readonly size: number;
      readonly color: string;
      readonly align: "left" | "center";
      readonly weight: 400 | 600 | 700;
    };

export interface PatternFrame {
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly primitives: readonly Primitive[];
}

export interface PatternInput {
  readonly frame: number;
  readonly fps: ContentFps;
  readonly width: number;
  readonly height: number;
  readonly screens: readonly MotionScreen[];
}

/** Content colors: bright, saturated and distinct, chosen to read clearly on LED. */
export const MOTION_COLORS = {
  ink: "#05060E",
  deep: "#070B24",
  cyan: "#3EC1E3",
  blue: "#2F6FE4",
  violet: "#7B61FF",
  magenta: "#FF3DC8",
  white: "#FFFFFF",
} as const;

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Positive remainder, so positions wrap the same way going left or right. */
const mod = (a: number, n: number) => ((a % n) + n) % n;

function seconds(input: PatternInput) {
  return input.frame / input.fps;
}

/** Grid cell in master pixels: a multiple of 8, scaled to the canvas, between 32 and 256. */
export function gridCell(width: number, height: number): number {
  return clamp(Math.round(Math.min(width, height) / 6 / 8) * 8, 32, 256);
}

function movingGrid(input: PatternInput): PatternFrame {
  const { width: W, height: H } = input;
  const cell = gridCell(W, H);
  // Moves half a cell per second, in whole pixels.
  const travelled = Math.floor((seconds(input) * cell) / 2);
  const offset = travelled % cell;
  const firstIndex = Math.floor(travelled / cell);
  const minor = Math.max(1, Math.round(cell / 48));
  const lines = (length: number) => {
    const all: { at: number; major: boolean }[] = [];
    for (let k = 0, p = offset; p < length; k++, p += cell) all.push({ at: p, major: mod(k - firstIndex, 4) === 0 });
    return all;
  };
  const xs = lines(W);
  const ys = lines(H);
  return {
    width: W,
    height: H,
    background: MOTION_COLORS.deep,
    primitives: [
      { kind: "lines", axis: "x", at: xs.filter((l) => !l.major).map((l) => l.at), width: minor, color: MOTION_COLORS.cyan },
      { kind: "lines", axis: "y", at: ys.filter((l) => !l.major).map((l) => l.at), width: minor, color: MOTION_COLORS.cyan },
      { kind: "lines", axis: "x", at: xs.filter((l) => l.major).map((l) => l.at), width: minor * 3, color: MOTION_COLORS.magenta },
      { kind: "lines", axis: "y", at: ys.filter((l) => l.major).map((l) => l.at), width: minor * 3, color: MOTION_COLORS.magenta },
    ],
  };
}

/** Seconds for a scan to cross the whole master. */
export const SCAN_PERIOD_S = 4;

/** Position of the scan line, in whole master pixels. */
export function scanPosition(frame: number, fps: ContentFps, length: number): number {
  const phase = mod(frame / fps, SCAN_PERIOD_S) / SCAN_PERIOD_S;
  return Math.min(length - 1, Math.floor(phase * length));
}

function scan(input: PatternInput, axis: "x" | "y"): PatternFrame {
  const { width: W, height: H } = input;
  const length = axis === "x" ? W : H;
  const across = axis === "x" ? H : W;
  const pos = scanPosition(input.frame, input.fps, length);
  const bar = Math.max(2, Math.round(length / 240));
  const trail = Math.max(bar * 4, Math.round(length / 5));
  const color = axis === "x" ? MOTION_COLORS.cyan : MOTION_COLORS.magenta;
  const size = clamp(Math.round(across * 0.045), 12, 72);
  const stops: Stop[] = [[0, "rgba(0,0,0,0)"], [0.85, `${color}99`], [1, color]];
  const primitives: Primitive[] =
    axis === "x"
      ? [
          { kind: "linear", x: pos - trail, y: 0, w: trail, h: H, from: [pos - trail, 0], to: [pos, 0], stops },
          { kind: "rect", x: pos, y: 0, w: bar, h: H, color: MOTION_COLORS.white },
          { kind: "text", x: pos + bar + size * 0.4, y: H / 2 + size * 0.35, text: `x ${pos}`, size, color: MOTION_COLORS.white, align: "left", weight: 600 },
        ]
      : [
          { kind: "linear", x: 0, y: pos - trail, w: W, h: trail, from: [0, pos - trail], to: [0, pos], stops },
          { kind: "rect", x: 0, y: pos, w: W, h: bar, color: MOTION_COLORS.white },
          { kind: "text", x: size * 0.6, y: pos - size * 0.5, text: `y ${pos}`, size, color: MOTION_COLORS.white, align: "left", weight: 600 },
        ];
  return { width: W, height: H, background: MOTION_COLORS.ink, primitives };
}

/** Hue in whole degrees: one full turn every 6 seconds. */
export function cycleHue(frame: number, fps: ContentFps): number {
  return Math.floor((frame / fps) * 60) % 360;
}

/** Integer RGB for a fully saturated hue. */
export function hueToRgb(hue: number): [number, number, number] {
  const h = mod(hue, 360) / 60;
  const x = Math.round(255 * (1 - Math.abs((h % 2) - 1)));
  const sector = Math.floor(h);
  const table: [number, number, number][] = [
    [255, x, 0],
    [x, 255, 0],
    [0, 255, x],
    [0, x, 255],
    [x, 0, 255],
    [255, 0, x],
  ];
  return table[sector];
}

function rgbCycle(input: PatternInput): PatternFrame {
  const { width: W, height: H } = input;
  const hue = cycleHue(input.frame, input.fps);
  const [r, g, b] = hueToRgb(hue);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const ink = luminance > 140 ? "#000000" : "#FFFFFF";
  const size = clamp(Math.round(Math.min(W, H) * 0.06), 12, 96);
  return {
    width: W,
    height: H,
    background: `rgb(${r},${g},${b})`,
    primitives: input.screens.map((s) => ({
      kind: "text" as const,
      x: s.x + s.width / 2,
      y: s.y + s.height / 2 + size * 0.35,
      text: `R ${r}  G ${g}  B ${b}`,
      size: Math.min(size, Math.round(s.width / 9)),
      color: ink,
      align: "center" as const,
      weight: 600 as const,
    })),
  };
}

function frameCounter(input: PatternInput): PatternFrame {
  const { width: W, height: H, frame, fps } = input;
  const withinSecond = frame % fps;
  const primitives: Primitive[] = [];
  for (const s of input.screens) {
    const digits = String(frame).length;
    const big = Math.max(8, Math.floor(Math.min(s.height * 0.42, (s.width * 0.85) / (digits * 0.62))));
    const cx = s.x + s.width / 2;
    const cy = s.y + s.height * 0.46;
    primitives.push({ kind: "text", x: cx, y: cy + big * 0.36, text: String(frame), size: big, color: MOTION_COLORS.white, align: "center", weight: 700 });
    primitives.push({
      kind: "text",
      x: cx,
      y: cy + big * 0.36 + Math.max(8, big * 0.34),
      text: `${timecode(frame, fps)}  ${fps} fps`,
      size: Math.max(6, Math.round(big * 0.24)),
      color: MOTION_COLORS.cyan,
      align: "center",
      weight: 600,
    });
    // One segment per frame of the current second: shows frame progression at a glance.
    const barH = Math.max(2, Math.round(s.height * 0.06));
    const gap = Math.max(1, Math.round(s.width / (fps * 40)));
    const segW = (s.width - gap * (fps + 1)) / fps;
    if (segW >= 1) {
      for (let i = 0; i < fps; i++) {
        primitives.push({
          kind: "rect",
          x: s.x + gap + i * (segW + gap),
          y: s.y + s.height - barH - gap * 2,
          w: segW,
          h: barH,
          color: i === withinSecond ? MOTION_COLORS.white : i < withinSecond ? MOTION_COLORS.violet : "#1B1F3A",
        });
      }
    }
  }
  return { width: W, height: H, background: MOTION_COLORS.ink, primitives };
}

/** Height of the Content Flow wave at master x. Exported so continuity can be tested. */
export function flowWaveY(x: number, t: number, width: number, height: number): number {
  const wavelength = Math.max(width, height) * 0.45;
  return height * 0.5 + height * 0.26 * Math.sin(TAU * (x / wavelength - t / 3)) + height * 0.06 * Math.sin(TAU * (x / (wavelength * 0.37) + t / 1.7));
}

const FLOW_BANDS = [MOTION_COLORS.deep, MOTION_COLORS.cyan, MOTION_COLORS.deep, MOTION_COLORS.blue, MOTION_COLORS.deep, MOTION_COLORS.violet, MOTION_COLORS.deep, MOTION_COLORS.magenta];
const FLOW_ORBS = [
  { color: "62,193,227", radius: 0.34, speed: 7, lane: 0.3, phase: 0.0, bob: 5.0 },
  { color: "255,61,200", radius: 0.26, speed: 9, lane: 0.7, phase: 0.35, bob: 6.5 },
  { color: "123,97,255", radius: 0.4, speed: 11, lane: 0.5, phase: 0.6, bob: 8.0 },
  { color: "47,111,228", radius: 0.3, speed: 6, lane: 0.2, phase: 0.8, bob: 4.2 },
  { color: "255,255,255", radius: 0.16, speed: 5, lane: 0.6, phase: 0.15, bob: 3.3 },
];

function contentFlow(input: PatternInput): PatternFrame {
  const { width: W, height: H } = input;
  const t = seconds(input);
  const primitives: Primitive[] = [];

  // Diagonal bands of light, one palette period every `period` px, moving one period every 4 s.
  const period = Math.max(W, H) / 2.2;
  const angle = (16 * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const span = W * dx + H * dy;
  const shift = mod((t / 4) * period, period);
  const start = shift - period;
  const length = span + period * 2;
  const step = period / FLOW_BANDS.length;
  const stops: Stop[] = [];
  for (let k = 0, d = 0; d <= length + 1e-6; k++, d += step) {
    stops.push([Math.min(1, d / length), FLOW_BANDS[k % FLOW_BANDS.length]]);
  }
  primitives.push({ kind: "linear", x: 0, y: 0, w: W, h: H, from: [start * dx, start * dy], to: [(start + length) * dx, (start + length) * dy], stops });

  // Glows travel left to right across the whole master and wrap, so they cross every boundary.
  FLOW_ORBS.forEach((orb) => {
    const r = Math.max(8, H * orb.radius);
    const track = W + r * 2;
    const cx = mod(t * (W / orb.speed) + orb.phase * track, track) - r;
    const cy = H * (orb.lane + 0.18 * Math.sin(TAU * (t / orb.bob + orb.phase)));
    primitives.push({ kind: "glow", cx, cy, r, stops: [[0, `rgba(255,255,255,0.85)`], [0.18, `rgba(${orb.color},0.7)`], [1, `rgba(${orb.color},0)`]] });
  });

  // A continuous wave: any break at a screen edge shows a mapping error immediately.
  const sample = Math.max(2, W / 480);
  const points: number[] = [];
  for (let x = 0; x < W; x += sample) points.push(x, flowWaveY(x, t, W, H));
  points.push(W, flowWaveY(W, t, W, H));
  const lineWidth = Math.max(2, H / 140);
  primitives.push({ kind: "path", points, width: lineWidth * 5, color: "rgba(62,193,227,0.35)" });
  primitives.push({ kind: "path", points, width: lineWidth, color: MOTION_COLORS.white });

  return { width: W, height: H, background: MOTION_COLORS.deep, primitives };
}

export function renderPattern(id: PatternId, input: PatternInput): PatternFrame {
  switch (id) {
    case "grid":
      return movingGrid(input);
    case "scan-h":
      return scan(input, "x");
    case "scan-v":
      return scan(input, "y");
    case "rgb":
      return rgbCycle(input);
    case "counter":
      return frameCounter(input);
    case "flow":
      return contentFlow(input);
  }
}
