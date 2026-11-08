import type { ContentFps, MotionScreen } from "@/domain/motion";

/**
 * Aurora Gradient: a soft, moving multi-color field for the Motion Lab preview.
 *
 * Pure and deterministic. The frame depends only on the frame number, the content FPS, the master size
 * and the settings. Content is defined once over the whole master canvas, in master pixels, so it flows
 * across every screen boundary by construction, and screens never change it.
 *
 * It is built from the same primitives as the Motion Lab patterns (one linear gradient and additive
 * glows), so `preview/draw-pattern.ts` draws it unchanged. The types are structural copies, so this
 * engine doesn't depend on `engines/motion`.
 */

export type AuroraStop = readonly [offset: number, color: string];

export type AuroraPrimitive =
  | {
      readonly kind: "linear";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly from: readonly [number, number];
      readonly to: readonly [number, number];
      readonly stops: readonly AuroraStop[];
    }
  | { readonly kind: "glow"; readonly cx: number; readonly cy: number; readonly r: number; readonly stops: readonly AuroraStop[] };

export interface AuroraFrame {
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly primitives: readonly AuroraPrimitive[];
}

export interface AuroraInput {
  readonly frame: number;
  readonly fps: ContentFps;
  readonly width: number;
  readonly height: number;
  readonly screens: readonly MotionScreen[];
}

/** Content speeds: powers of two, so `frame × speed` is exact and the loop closes exactly. */
export const AURORA_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type AuroraSpeed = (typeof AURORA_SPEEDS)[number];

/** Direction the content travels, in degrees clockwise from "to the right", in master space (y down). */
export const AURORA_DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315] as const;
export type AuroraDirection = (typeof AURORA_DIRECTIONS)[number];

export interface AuroraSettings {
  /** Two to six `#RRGGBB` colors. */
  readonly colors: readonly string[];
  readonly speed: AuroraSpeed;
  readonly direction: AuroraDirection;
}

export const AURORA_PRESETS = [
  { id: "borealis", name: "Borealis", colors: ["#22E3A0", "#3EC1E3", "#7B61FF"] },
  { id: "signal", name: "Signal", colors: ["#3EC1E3", "#7B61FF", "#FF3DC8"] },
  { id: "sunset", name: "Sunset", colors: ["#FF6A3D", "#FF3DC8", "#7B61FF"] },
  { id: "ocean", name: "Ocean", colors: ["#2F6FE4", "#3EC1E3", "#22E3C8"] },
  { id: "ember", name: "Ember", colors: ["#FF3D3D", "#FF9A3D", "#FFD23D"] },
] as const;

export const DEFAULT_AURORA: AuroraSettings = { colors: AURORA_PRESETS[0].colors, speed: 1, direction: 0 };

/** At speed 1 the content repeats exactly every LOOP_S seconds; at speed s, every LOOP_S / s. */
export const AURORA_LOOP_S = 20;

/** The night sky behind the colors. */
export const AURORA_NIGHT = "#04050F";

const TAU = Math.PI * 2;
const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Integer RGB of a `#RRGGBB` color. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Valid colors only, two to six of them. Falls back to the default palette. */
export function auroraPalette(colors: readonly string[]): readonly string[] {
  const valid = colors.filter((c) => HEX.test(c)).slice(0, 6);
  return valid.length >= 2 ? valid : DEFAULT_AURORA.colors;
}

/**
 * Where the loop is, in [0, 1). Depends only on the frame, the content FPS and the speed, and the same
 * content time gives the same phase at every content FPS (frame 30 at 30 fps equals frame 60 at 60 fps).
 */
export function auroraPhase(frame: number, fps: ContentFps, speed: AuroraSpeed): number {
  const loopFrames = AURORA_LOOP_S * fps;
  return mod(frame * speed, loopFrames) / loopFrames;
}

/** Mixes `color` toward the night sky: 0 is night, 1 is the full color. Integer channels. */
function dim(rgb: readonly [number, number, number], amount: number): string {
  const night = hexToRgb(AURORA_NIGHT);
  const c = rgb.map((v, i) => Math.round(night[i] + (v - night[i]) * amount));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Fixed per-glow shape. Cycles and wobbles are whole numbers per loop, so the loop closes exactly. */
const GLOW_CYCLES = [1, 2, 1, 3, 2, 1, 2, 3];
const GLOW_WOBBLE = [1, 2, 3, 1, 2, 3, 1, 2];
const GLOW_SIZE = [1, 0.75, 0.9, 0.65, 1.1, 0.8, 0.7, 0.95];

export function auroraGradient(input: AuroraInput, settings: AuroraSettings = DEFAULT_AURORA): AuroraFrame {
  const { width: W, height: H } = input;
  const palette = auroraPalette(settings.colors).map(hexToRgb);
  const n = palette.length;
  const phase = auroraPhase(input.frame, input.fps, settings.speed);

  // Axes: u is the travel direction, v is across it. Centered on the master.
  const angle = (settings.direction * Math.PI) / 180;
  const ux = Math.round(Math.cos(angle) * 1e9) / 1e9;
  const uy = Math.round(Math.sin(angle) * 1e9) / 1e9;
  const vx = -uy;
  const vy = ux;
  const span = Math.abs(W * ux) + Math.abs(H * uy);
  const across = Math.abs(W * vx) + Math.abs(H * vy);
  const cx = W / 2;
  const cy = H / 2;
  const at = (d: number, c: number): [number, number] => [cx + d * ux + c * vx, cy + d * uy + c * vy];

  const primitives: AuroraPrimitive[] = [];

  // Base: the palette as broad bands along u, dimmed toward the night, moving one period per loop.
  const period = Math.max(span, across) * 0.9;
  const shift = phase * period;
  const start = -span / 2 - period + shift;
  const length = span + period * 2;
  const step = period / n;
  const stops: AuroraStop[] = [];
  for (let k = 0, d = 0; d <= length + step; k++, d += step) {
    stops.push([Math.min(1, d / length), dim(palette[k % n], 0.42)]);
  }
  primitives.push({ kind: "linear", x: 0, y: 0, w: W, h: H, from: at(start, 0), to: at(start + length, 0), stops });

  // Glows: soft lights drifting along u and swaying across it, wrapping so they cross every screen edge.
  const base = clamp(Math.sqrt(W * H) * 0.32, 16, Math.max(span, across));
  const count = clamp(Math.ceil((span / base) * 1.4), 5, 16);
  for (let i = 0; i < count; i++) {
    const r = base * GLOW_SIZE[i % GLOW_SIZE.length];
    const track = span + r * 2;
    const offset = i / count;
    const d = mod((phase * GLOW_CYCLES[i % GLOW_CYCLES.length] + offset) * track, track) - track / 2;
    const lane = ((i * 7) % count) / count - 0.5;
    const c = across * (lane * 0.7 + 0.22 * Math.sin(TAU * (phase * GLOW_WOBBLE[i % GLOW_WOBBLE.length] + offset)));
    const [gx, gy] = at(d, c);
    const [r0, g0, b0] = palette[i % n];
    primitives.push({
      kind: "glow",
      cx: gx,
      cy: gy,
      r,
      stops: [
        [0, `rgba(${r0},${g0},${b0},0.62)`],
        [0.45, `rgba(${r0},${g0},${b0},0.28)`],
        [1, `rgba(${r0},${g0},${b0},0)`],
      ],
    });
  }

  return { width: W, height: H, background: AURORA_NIGHT, primitives };
}

/** Parses `rgb(r,g,b)` or `rgba(r,g,b,a)` as written by this engine. */
function parseColor(color: string): [number, number, number, number] {
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  if (!m) {
    const [r, g, b] = hexToRgb(color);
    return [r, g, b, 1];
  }
  const p = m[1].split(",").map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

function stopColor(stops: readonly AuroraStop[], t: number): [number, number, number, number] {
  const x = clamp(t, 0, 1);
  if (x <= stops[0][0]) return parseColor(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    const [o1, c1] = stops[i];
    if (x <= o1) {
      const [o0, c0] = stops[i - 1];
      const k = o1 === o0 ? 1 : (x - o0) / (o1 - o0);
      const a = parseColor(c0);
      const b = parseColor(c1);
      return [0, 1, 2, 3].map((j) => a[j] + (b[j] - a[j]) * k) as [number, number, number, number];
    }
  }
  return parseColor(stops[stops.length - 1][1]);
}

/**
 * Reference color of an Aurora frame at a master pixel center, as float RGB in 0–255.
 *
 * Evaluates the same primitives the preview draws: the linear gradient, then each glow added on top
 * (`lighter` blending), clipped at 255. It is a test oracle for continuity and slicing, not a
 * bit-exact model of a browser's gradient rasterizer.
 */
export function sampleAurora(frame: AuroraFrame, x: number, y: number): [number, number, number] {
  const px = x + 0.5;
  const py = y + 0.5;
  let rgb: [number, number, number] = [0, 0, 0];
  for (const p of frame.primitives) {
    if (p.kind === "linear") {
      const dx = p.to[0] - p.from[0];
      const dy = p.to[1] - p.from[1];
      const t = ((px - p.from[0]) * dx + (py - p.from[1]) * dy) / (dx * dx + dy * dy);
      const [r, g, b, a] = stopColor(p.stops, t);
      rgb = [rgb[0] * (1 - a) + r * a, rgb[1] * (1 - a) + g * a, rgb[2] * (1 - a) + b * a];
    } else {
      const dist = Math.hypot(px - p.cx, py - p.cy);
      if (dist >= p.r) continue;
      const [r, g, b, a] = stopColor(p.stops, dist / p.r);
      rgb = [Math.min(255, rgb[0] + r * a), Math.min(255, rgb[1] + g * a), Math.min(255, rgb[2] + b * a)];
    }
  }
  return rgb;
}
