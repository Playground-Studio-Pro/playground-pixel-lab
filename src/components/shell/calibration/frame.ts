import type { ContentFps } from "@/domain/motion";
import type { Rect } from "@/domain/units";
import { timecode } from "@/engines/motion/clock";
import { CAL_ADVANCE, CAL_CABINET, CAL_CHECKER, CAL_COLORS, CAL_LOGO, CAL_MIN_TEXT, CAL_PLATE, CAL_SCALE, CAL_SWEEP, CAL_TINT, lighten, readableOn, tint } from "./tokens";

/**
 * Screen identification and calibration frames, as drawing primitives in exact integer pixels.
 *
 * Pure: the frame depends only on its input. It reads rectangles that `resolveMapping` already
 * produced and never computes a mapping value. Every line is a filled rectangle on whole pixels, so
 * a 1 px line is exactly one LED pixel wide at 1:1. Text is laid out with a fixed character advance
 * (the calibration face is monospace), so label boxes are known without a canvas and can be tested.
 */

export type CalibrationMode = "identification" | "calibration";
export type LogoMode = "center" | "watermark" | "off";

type Box = Rect<number>;

export interface CalibrationScreen {
  /** Display identifier, such as SCR-01. A label for people, not a project id. */
  readonly label: string;
  readonly name: string;
  /** Where the screen sits in this frame, in the frame's own pixel space. */
  readonly rect: Box;
  /** Position of the screen's first pixel on the master canvas. */
  readonly canvasX: number;
  readonly canvasY: number;
  readonly output?: { readonly label: string; readonly name: string };
  readonly cabinet?: { readonly pixelsX: number; readonly pixelsY: number; readonly columns: number; readonly rows: number };
  /** Physical size in integer micrometres, from `resolveMapping` (the screen's stage rectangle). */
  readonly physical?: { readonly widthUm: number; readonly heightUm: number };
  /** Accent color, already checked for contrast on a dark field (`screenAccent`). */
  readonly accent: string;
}

/** Calibration mode elements a technician can switch off. Identification mode has a fixed set. */
export interface CalibrationElements {
  readonly grid: boolean;
  readonly crosshair: boolean;
  readonly references: boolean;
  readonly frameCounter: boolean;
  readonly metadata: boolean;
}

export const DEFAULT_ELEMENTS: CalibrationElements = { grid: true, crosshair: true, references: true, frameCounter: true, metadata: true };

export interface CalibrationInput {
  readonly width: number;
  readonly height: number;
  readonly screens: readonly CalibrationScreen[];
  readonly mode: CalibrationMode;
  /** `aspect` is the logo's own width divided by height. It is never stretched. */
  readonly logo: { readonly mode: LogoMode; readonly aspect: number };
  readonly elements?: Partial<CalibrationElements>;
  /** Content rate the frame counter is labelled with. Not a browser or panel rate. */
  readonly fps: ContentFps;
  /**
   * A moving card: a sweep bar crosses the master (`CAL_SWEEP`), and identification mode shows the frame
   * counter and timecode too. Off for still frames such as the Preview dialog's PNG.
   */
  readonly motion?: boolean;
}

export type CounterField = "frame" | "timecode";

interface TextStyle {
  readonly x: number;
  /** Top of the text box. The baseline sits `CAL_BASELINE` × size below it. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly weight: 500 | 600 | 700;
  readonly fill: string;
  /** Index of the screen this label belongs to, in `input.screens`. */
  readonly owner: number;
}

export type CalNode =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly fill: string }
  | ({ readonly kind: "text"; readonly text: string } & TextStyle)
  /** Text that changes with the frame number. Its box is fixed, so playback never moves the layout. */
  | ({ readonly kind: "counter"; readonly field: CounterField } & TextStyle)
  | { readonly kind: "logo"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly opacity: number };

/** A bar `barWidth` wide crossing `width` once every `period` frames, wrapping at the right edge. */
export interface Sweep {
  readonly width: number;
  readonly barWidth: number;
  readonly period: number;
  /** The screens it is drawn on. Master pixels no screen covers stay black. */
  readonly areas: readonly Box[];
  /** One edge marker per screen large enough for it (`edgeMarkerRects`). */
  readonly edges: readonly EdgeTrack[];
  readonly fill: string;
}

/**
 * A marker running clockwise around the inside of a screen from its top-left: a band `thickness` px wide,
 * `inset` px in from the screen's outer pixel, `length` px long, once per period.
 */
export interface EdgeTrack {
  readonly box: Box;
  readonly inset: number;
  readonly thickness: number;
  readonly length: number;
}

const even = (n: number) => n - (n % 2);

/** Bar width for a master `width` px wide: `CAL_SWEEP.width`, even, at least 2. */
export function sweepBarWidth(width: number): number {
  const rule = CAL_SWEEP.width;
  return Math.max(2, even(Math.min(Math.max(Math.round(width * rule.ratio), rule.min), Math.floor(width * rule.maxShare))));
}

/** The edge track of a screen, or null when it is too small to carry one beside its border. */
export function edgeTrack(box: Box): EdgeTrack | null {
  const rule = CAL_SWEEP.edge;
  const m = Math.min(box.width, box.height);
  const thickness = clamp(Math.round(m * rule.thickness.ratio), rule.thickness.min, rule.thickness.max);
  const inner = m - 2 * rule.inset - thickness;
  if (m < 24 || inner < thickness) return null;
  const perimeter = 2 * (box.width - 2 * rule.inset - thickness) + 2 * (box.height - 2 * rule.inset - thickness);
  return { box, inset: rule.inset, thickness, length: Math.max(2 * thickness, Math.round(perimeter * rule.lengthShare)) };
}

/** The sweep for a frame `width` px wide at `fps`: one crossing per `CAL_SWEEP.seconds`. */
export function sweepFor(width: number, fps: ContentFps, areas: readonly Box[]): Sweep {
  return { width, barWidth: sweepBarWidth(width), period: CAL_SWEEP.seconds * fps, areas, edges: areas.flatMap((a) => edgeTrack(a) ?? []), fill: CAL_COLORS.white };
}

/**
 * The edge marker's rectangles at `frame`. Its head is at `floor(phase × perimeter / period)` along the
 * clockwise track (top, right, bottom, left); the part past the end wraps to the start, so one period later
 * it is back where it began. Pure.
 */
export function edgeMarkerRects(track: EdgeTrack, period: number, frame: number): Box[] {
  const { box, inset: d, thickness: t } = track;
  const a = box.width - 2 * d - t;
  const b = box.height - 2 * d - t;
  const perimeter = 2 * a + 2 * b;
  const phase = ((frame % period) + period) % period;
  const start = Math.floor((phase * perimeter) / period);
  const spans: [number, number][] = start + track.length <= perimeter ? [[start, start + track.length]] : [[start, perimeter], [0, start + track.length - perimeter]];
  const edges: [number, number, (u: number, v: number) => Box][] = [
    [0, a, (u, v) => ({ x: box.x + d + u, y: box.y + d, width: v - u + t, height: t })],
    [a, a + b, (u, v) => ({ x: box.x + box.width - d - t, y: box.y + d + u - a, width: t, height: v - u + t })],
    [a + b, 2 * a + b, (u, v) => ({ x: box.x + box.width - d - t - (v - a - b), y: box.y + box.height - d - t, width: v - u + t, height: t })],
    [2 * a + b, perimeter, (u, v) => ({ x: box.x + d, y: box.y + box.height - d - t - (v - 2 * a - b), width: t, height: v - u + t })],
  ];
  const out: Box[] = [];
  for (const [s0, s1] of spans) {
    for (const [e0, e1, rect] of edges) {
      const u = Math.max(s0, e0);
      const v = Math.min(s1, e1);
      if (v > u) out.push(rect(u, v));
    }
  }
  return out;
}

/** Left edge of the bar at `frame`: `floor(phase × width / period)`, so each step is ⌊w/p⌋ or ⌈w/p⌉ px. */
export function sweepLeft(sweep: Sweep, frame: number): number {
  const phase = ((frame % sweep.period) + sweep.period) % sweep.period;
  return Math.floor((phase * sweep.width) / sweep.period);
}

/**
 * The bar's rectangles at `frame`, clipped to each screen. The part past the right edge wraps to the left, and
 * one period later the bar is back where it started, so the bar is always visible and the last frame of a
 * period leads into the first. Pure: same sweep and frame, same rectangles.
 */
export function sweepRects(sweep: Sweep, frame: number): Box[] {
  const left = sweepLeft(sweep, frame);
  const spans: [number, number][] = [[left, Math.min(left + sweep.barWidth, sweep.width)]];
  if (left + sweep.barWidth > sweep.width) spans.push([0, left + sweep.barWidth - sweep.width]);
  const out: Box[] = [];
  for (const [x0, x1] of spans) {
    for (const r of sweep.areas) {
      const cx0 = Math.max(x0, r.x);
      const cx1 = Math.min(x1, r.x + r.width);
      if (cx1 > cx0 && r.height > 0) out.push({ x: cx0, y: r.y, width: cx1 - cx0, height: r.height });
    }
  }
  return out;
}

export interface CalibrationFrame {
  readonly width: number;
  readonly height: number;
  readonly mode: CalibrationMode;
  readonly nodes: readonly CalNode[];
  /** Area kept clear around a centered logo. Null in watermark and off modes. */
  readonly logoKeepOut: Box | null;
  /**
   * The sweep bar of a moving card, or null. Where it is depends on the frame number (`sweepRects`). It is
   * drawn just before `nodes[sweep.before]`: over the field and grid, under lines, plates, marks, logo and text.
   */
  readonly sweep: (Sweep & { readonly before: number }) | null;
}

/** Fixed-width text for a counter: `F 000123` or a non-drop timecode. */
export function counterText(field: CounterField, frame: number, fps: ContentFps): string {
  return field === "frame" ? `F ${String(frame % 1_000_000).padStart(6, "0")}` : timecode(frame, fps);
}

const COUNTER_CHARS: Record<CounterField, number> = { frame: 8, timecode: 11 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sized = (rule: { ratio: number; min: number; max: number }, m: number) => clamp(Math.round(m * rule.ratio), rule.min, rule.max);
const textWidth = (chars: number, size: number) => Math.ceil(chars * size * CAL_ADVANCE);
const area = (b: Box) => Math.max(0, b.width) * Math.max(0, b.height);
const expand = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by });
const hits = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

/** The largest rectangle left in `from` beside `cut`: above, below, left or right of it. */
function largestRemainder(from: Box, cut: Box): Box {
  if (!hits(from, cut)) return from;
  const right = from.x + from.width;
  const bottom = from.y + from.height;
  const options: Box[] = [
    { x: from.x, y: from.y, width: from.width, height: cut.y - from.y },
    { x: from.x, y: cut.y + cut.height, width: from.width, height: bottom - (cut.y + cut.height) },
    { x: from.x, y: from.y, width: cut.x - from.x, height: from.height },
    { x: cut.x + cut.width, y: from.y, width: right - (cut.x + cut.width), height: from.height },
  ];
  return options.reduce((best, o) => (area(o) > area(best) ? o : best), { x: from.x, y: from.y, width: 0, height: 0 });
}

/** Thickness with the same parity as `length`, so a centered line sits on whole pixels. */
const centered = (thickness: number, length: number) => ((length - thickness) % 2 === 0 ? thickness : thickness + 1);

interface Part {
  readonly text: string;
  readonly fill: string;
  readonly counter?: CounterField;
}
interface Line {
  readonly size: number;
  readonly weight: 500 | 600 | 700;
  readonly parts: readonly Part[];
}

const PART_GAP = 2;
const lineChars = (line: Line) => line.parts.reduce((n, p) => n + p.text.length, 0) + PART_GAP * (line.parts.length - 1);
const lineWidth = (line: Line) => textWidth(lineChars(line), line.size);
const lineGap = (next: Line) => Math.max(2, Math.round(next.size * 0.45));
const blockWidth = (lines: readonly Line[]) => Math.max(0, ...lines.map(lineWidth));
const blockHeight = (lines: readonly Line[]) => lines.reduce((h, line, i) => h + line.size + (i > 0 ? lineGap(line) : 0), 0);

/** Shortens a line to `maxWidth` with an ellipsis. Null if nothing readable is left. Counters are never cut. */
function fitLine(line: Line, maxWidth: number): Line | null {
  const maxChars = Math.floor(maxWidth / (line.size * CAL_ADVANCE));
  let parts = [...line.parts];
  while (parts.length > 0) {
    const candidate = { ...line, parts };
    const over = lineChars(candidate) - maxChars;
    if (over <= 0) return candidate;
    const last = parts[parts.length - 1];
    const keep = last.text.length - over - 1;
    if (!last.counter && keep >= 3) {
      parts[parts.length - 1] = { ...last, text: `${last.text.slice(0, keep).trimEnd()}…` };
      return { ...line, parts };
    }
    parts = parts.slice(0, -1);
  }
  return null;
}

interface Layers {
  readonly field: CalNode[];
  readonly grid: CalNode[];
  readonly lines: CalNode[];
  readonly plates: CalNode[];
  readonly marks: CalNode[];
  readonly text: CalNode[];
}

const rectNode = (x: number, y: number, width: number, height: number, fill: string): CalNode => ({ kind: "rect", x, y, width, height, fill });

function logoRect(width: number, height: number, logo: CalibrationInput["logo"]): Box | null {
  if (logo.mode === "off" || !(logo.aspect > 0)) return null;
  const rule = CAL_LOGO[logo.mode];
  let h = Math.round(Math.min(width, height) * rule.height);
  let w = Math.round(h * logo.aspect);
  const maxW = Math.floor(width * rule.maxWidth);
  if (w > maxW) {
    w = maxW;
    h = Math.round(w / logo.aspect);
  }
  if (w < 16 || h < 6) return null;
  return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h };
}

/** Grid pitch inside a cabinet: a quarter or half of it when that is a whole number of at least 16 px. */
export function minorPitch(cabinetPixels: number | undefined): number {
  if (!cabinetPixels) return 64;
  for (const k of [4, 2]) if (cabinetPixels % k === 0 && cabinetPixels / k >= 16) return cabinetPixels / k;
  return cabinetPixels;
}

/** Shorter side, in pixels, below which a screen uses the compact layout. */
const COMPACT_BELOW = 192;

interface ScreenContext {
  readonly index: number;
  readonly mode: CalibrationMode;
  readonly elements: CalibrationElements;
  readonly fps: ContentFps;
  readonly motion: boolean;
  /** Areas this screen's labels and marks must stay out of: the logo, and overlaps another screen owns. */
  readonly obstacles: Box[];
  readonly logoKeepOut: Box | null;
  /** Label plates already placed anywhere in the frame. */
  readonly placed: Box[];
  readonly layers: Layers;
  /** Work to run after every screen has placed its own labels: cabinet labels, which give way to all of them. */
  readonly deferred: (() => void)[];
}

/** One cabinet's position in its screen: 1-based row and column, and its number counted left to right, top to bottom. */
export interface CabinetCell {
  readonly row: number;
  readonly column: number;
  readonly number: number;
  /** The cabinet's pixels, in the frame's space. */
  readonly box: Box;
}

/**
 * Every cabinet of a screen, from its top-left corner: rows top to bottom, columns left to right, numbered
 * in reading order from 1. Read from the screen's cabinet grid (`resolveMapping`); nothing is computed beyond
 * multiplying it out. Not a data-cabling order: the model has no cabling.
 */
export function cabinetCells(s: CalibrationScreen): CabinetCell[] {
  const cab = s.cabinet;
  if (!cab || cab.columns < 1 || cab.rows < 1 || cab.pixelsX < 1 || cab.pixelsY < 1) return [];
  const cells: CabinetCell[] = [];
  for (let r = 0; r < cab.rows; r++) {
    for (let col = 0; col < cab.columns; col++) {
      const box = intersect({ x: s.rect.x + col * cab.pixelsX, y: s.rect.y + r * cab.pixelsY, width: cab.pixelsX, height: cab.pixelsY }, s.rect);
      if (area(box) > 0) cells.push({ row: r + 1, column: col + 1, number: r * cab.columns + col + 1, box });
    }
  }
  return cells;
}

/** Row letters: 1 → A, 26 → Z, 27 → AA, 28 → AB. */
export function rowLetters(row: number): string {
  let n = row;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** A cabinet's label: its row letter and column number, `A1`, `B12`. */
export function cabinetLabelText(cell: CabinetCell): string {
  return `${rowLetters(cell.row)}${cell.column}`;
}

/** Margin inside a cabinet around its label: the seam pixel, then a share of the text size. */
const cabinetMargin = (size: number) => 1 + Math.max(2, Math.round(size * CAL_CABINET.margin));

/** The text size a cabinet label gets in a `width` × `height` cabinet, or null if it doesn't fit at the minimum. */
export function cabinetLabelSize(width: number, height: number, text: string): number | null {
  const fits = (size: number) => textWidth(text.length, size) <= width - 2 * cabinetMargin(size) && size <= height - 2 * cabinetMargin(size);
  for (let size = clamp(Math.round(Math.min(width, height) * CAL_CABINET.ratio), CAL_MIN_TEXT, CAL_CABINET.max); size >= CAL_MIN_TEXT; size--) if (fits(size)) return size;
  return null;
}

/** Micrometres as metres with three decimals, `16.200m`, rounded to the millimetre in integers. */
export function metres(um: number): string {
  const mm = Math.round(um / 1000);
  const sign = mm < 0 ? "-" : "";
  const abs = Math.abs(mm);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, "0")}m`;
}

/**
 * A corner-to-corner diagonal of `box`, `thickness` px across, as whole-pixel runs: one run per step along the
 * shorter side, so it has no anti-aliasing and the same pixels on every canvas. `anti` runs from the top-right
 * corner to the bottom-left one.
 */
export function diagonalRuns(box: Box, thickness: number, anti: boolean): Box[] {
  const { x, y, width: w, height: h } = box;
  const out: Box[] = [];
  const half = Math.floor(thickness / 2);
  if (w >= h) {
    for (let i = 0; i < h; i++) {
      const a = Math.floor((i * w) / h);
      const len = Math.max(1, Math.floor(((i + 1) * w) / h) - a);
      const left = anti ? w - a - len : a;
      const top = clamp(i - half, 0, h - thickness);
      out.push({ x: x + left, y: y + top, width: len, height: Math.min(thickness, h) });
    }
  } else {
    for (let j = 0; j < w; j++) {
      const a = Math.floor((j * h) / w);
      const len = Math.max(1, Math.floor(((j + 1) * h) / w) - a);
      const col = anti ? w - 1 - j : j;
      out.push({ x: x + clamp(col - half, 0, w - thickness), y: y + a, width: Math.min(thickness, w), height: len });
    }
  }
  return out;
}

/**
 * A circle ring of outer radius `r` and `thickness` px, centered on (cx, cy) in pixel-edge coordinates, as two
 * whole-pixel runs per row. Pure integer layout from `Math.sqrt`, which is exact-rounded in every engine.
 */
export function ringRuns(cx: number, cy: number, r: number, thickness: number): Box[] {
  const out: Box[] = [];
  const inner = Math.max(0, r - thickness);
  for (let row = -r; row < r; row++) {
    const yc = row + 0.5;
    const ox = Math.floor(Math.sqrt(Math.max(0, r * r - yc * yc)) + 0.5);
    if (ox <= 0) continue;
    const ix = Math.abs(yc) < inner ? Math.floor(Math.sqrt(inner * inner - yc * yc) + 0.5) : 0;
    const y = cy + row;
    if (ix <= 0) out.push({ x: cx - ox, y, width: 2 * ox, height: 1 });
    else out.push({ x: cx - ox, y, width: ox - ix, height: 1 }, { x: cx + ix, y, width: ox - ix, height: 1 });
  }
  return out;
}

/** Plate around a cabinet label: just enough to keep the sweep bar and grid lines off its glyphs. */
const CABINET_PLATE_PAD = 2;

/** Frame counter, timecode and content rate, as a corner block. */
const counterLines = (title: number, base: number, fps: ContentFps): Line[] => [
  { size: title, weight: 700, parts: [{ text: "0".repeat(COUNTER_CHARS.frame), fill: CAL_COLORS.white, counter: "frame" }] },
  { size: base, weight: 600, parts: [{ text: "0".repeat(COUNTER_CHARS.timecode), fill: CAL_COLORS.white, counter: "timecode" }] },
  { size: base, weight: 500, parts: [{ text: `CONTENT ${fps} FPS`, fill: CAL_COLORS.muted }] },
];

function layoutScreen(s: CalibrationScreen, c: ScreenContext): void {
  const { x, y, width: w, height: h } = s.rect;
  if (w < 1 || h < 1) return;
  const { layers, obstacles, placed } = c;
  const cal = c.mode === "calibration";
  const m = Math.min(w, h);
  const fieldColor = cal ? CAL_COLORS.black : s.accent;
  const cells = cabinetCells(s);
  /** The tone under a cabinet: identification alternates two tones of the screen's color, like a checkerboard. */
  const toneOf = (cell: CabinetCell) => (cal ? CAL_COLORS.black : (cell.row + cell.column) % 2 === 0 ? lighten(s.accent, CAL_CHECKER.light) : s.accent);

  layers.field.push(rectNode(x, y, w, h, fieldColor));
  if (!cal) for (const cell of cells) layers.field.push(rectNode(cell.box.x, cell.box.y, cell.box.width, cell.box.height, toneOf(cell)));

  // Cabinet seams: 2 px straddling each seam, the last pixel of one cabinet and the first of the next. A light
  // tint between identification's two tones, as on a stage test card.
  const cab = s.cabinet;
  const seamColor = cal ? tint(s.accent, CAL_TINT.gridSeam) : lighten(s.accent, CAL_CHECKER.seam);
  const showGrid = cal ? c.elements.grid : true;
  const pitchX = minorPitch(cab?.pixelsX);
  const pitchY = minorPitch(cab?.pixelsY);
  if (showGrid && w >= 8 && h >= 8) {
    if (cal) {
      const minor = tint(s.accent, CAL_TINT.gridMinor);
      for (let p = pitchX; p < w; p += pitchX) if (!cab || p % cab.pixelsX !== 0) layers.grid.push(rectNode(x + p, y, 1, h, minor));
      for (let p = pitchY; p < h; p += pitchY) if (!cab || p % cab.pixelsY !== 0) layers.grid.push(rectNode(x, y + p, w, 1, minor));
    }
    if (cab) {
      for (let p = cab.pixelsX; p < w; p += cab.pixelsX) layers.grid.push(rectNode(x + p - 1, y, 2, h, seamColor));
      for (let p = cab.pixelsY; p < h; p += cab.pixelsY) layers.grid.push(rectNode(x, y + p - 1, w, 2, seamColor));
    }
  }

  // The outermost pixel of every edge is white: a cropped or shifted screen loses an edge.
  const border = [rectNode(x, y, w, 1, CAL_COLORS.white), rectNode(x, y + h - 1, w, 1, CAL_COLORS.white), rectNode(x, y, 1, h, CAL_COLORS.white), rectNode(x + w - 1, y, 1, h, CAL_COLORS.white)];
  if (m < 24) {
    layers.marks.push(...border);
    return;
  }

  const stroke = cal ? 1 : sized(CAL_SCALE.identStroke, m);
  const inset = sized(CAL_SCALE.inset, m);
  const arm = Math.max(4, Math.min(sized(CAL_SCALE.arm, m), Math.floor((m - 2 * inset) / 3)));
  // Text scales with the screen's area, not only its shorter side, so a portrait screen beside a
  // wide wall doesn't end up with type half the size. Bounded so a ribbon doesn't get oversized text.
  const t = clamp(Math.round(Math.sqrt(w * h)), m, 2 * m);
  const base = sized(CAL_SCALE.text, t);
  // Small screens drop the orientation label and tighten their spacing, and identification mode
  // uses one centered block: the identifier needs the room.
  const compact = m < COMPACT_BELOW;
  const gap = compact ? 2 : Math.max(2, Math.round(base * 0.5));
  const platePad = compact ? 2 : Math.max(2, Math.round(base * 0.4));
  const origin = clamp(Math.round(m / 48), stroke + 2, 24);
  const off = inset + origin + gap;
  const safe: Box = { x: x + 1, y: y + 1, width: w - 2, height: h - 2 };
  // The part of this screen that no other screen owns. Corner labels anchor to it, so a screen whose
  // corner lies under another screen still shows what it is.
  const own = obstacles.filter((o) => o !== c.logoKeepOut).reduce((left, o) => largestRemainder(left, o), s.rect);
  const blocked = (box: Box) => obstacles.some((o) => hits(o, box)) || placed.some((p) => hits(p, box));

  /** Reserves a label's plate if it's inside the screen and clear of everything placed so far. */
  // Label plates are black: identification's field has two tones, and white text reads on black.
  const reserve = (box: Box, pad = platePad, fill: string = CAL_COLORS.black): boolean => {
    if (!inside(box, safe)) return false;
    const plate = intersect(expand(box, pad), safe);
    if (blocked(plate)) return false;
    placed.push(plate);
    layers.plates.push(rectNode(plate.x, plate.y, plate.width, plate.height, fill));
    return true;
  };

  const emit = (lines: readonly Line[], bx: number, by: number, bw: number, align: "left" | "right" | "center") => {
    let ty = by;
    lines.forEach((line, i) => {
      if (i > 0) ty += lineGap(line);
      const lw = lineWidth(line);
      let tx = align === "left" ? bx : align === "right" ? bx + bw - lw : bx + Math.floor((bw - lw) / 2);
      for (const part of line.parts) {
        const width = textWidth(part.text.length, line.size);
        const style = { x: tx, y: ty, width, height: line.size, size: line.size, weight: line.weight, fill: part.fill, owner: c.index };
        layers.text.push(part.counter ? { kind: "counter", field: part.counter, ...style } : { kind: "text", text: part.text, ...style });
        tx += textWidth(part.text.length + PART_GAP, line.size);
      }
      ty += line.size;
    });
  };

  /** Fits lines to a width, dropping any that can't be shortened to fit. */
  const fitted = (lines: readonly Line[], maxWidth: number) => lines.flatMap((line) => fitLine(line, maxWidth) ?? []);

  // Cabinet labels: row letter and column number, centered in every cabinet, in both modes. They run after
  // every screen's own labels (`deferred`), so they never take the room of a plate, identifier or counter, and
  // are dropped where they would cover a label, a corner mark, the logo or a shared area. Their plate is the
  // cabinet's own tone: it only keeps lines and the sweep off the glyphs.
  const markBoxes: Box[] = [];
  c.deferred.push(() => {
    for (const cell of cells) {
      const text = cabinetLabelText(cell);
      const size = cabinetLabelSize(cell.box.width, cell.box.height, text);
      if (size === null) continue;
      const tone = toneOf(cell);
      const line: Line = { size, weight: 700, parts: [{ text, fill: cal ? CAL_COLORS.muted : readableOn(tone) }] };
      const bw = lineWidth(line);
      const b = cell.box;
      // Centered; where a corner mark or origin square is in the way, nudged a quarter of the cabinet down,
      // right, or both, and still inside the cabinet.
      const cx0 = b.x + Math.floor((b.width - bw) / 2);
      const cy0 = b.y + Math.floor((b.height - size) / 2);
      const qx = Math.floor(b.width / 4);
      const qy = Math.floor(b.height / 4);
      for (const [dx, dy] of [[0, 0], [0, qy], [qx, 0], [qx, qy]]) {
        const box = { x: cx0 + dx, y: cy0 + dy, width: bw, height: size };
        if (!inside(expand(box, cabinetMargin(size) - 1), b)) continue;
        if (markBoxes.some((mb) => hits(mb, expand(box, 1)))) continue;
        // A tight plate: the screen's own pad would reach into the neighbouring cabinet.
        if (reserve(box, CABINET_PLATE_PAD, tone)) {
          emit([line], box.x, box.y, bw, "left");
          break;
        }
        // Blocked by a label or the logo, not a mark: the cabinet goes without, so labels never wander.
        if (dx === 0 && dy === 0 && !markBoxes.some((mb) => hits(mb, expand(box, 1)))) break;
      }
    }
  });

  /** Places a block centered on a point, kept inside `within`. */
  const placeCentered = (lines: readonly Line[], cx: number, cy: number, within: Box): boolean => {
    const bw = blockWidth(lines);
    const bh = blockHeight(lines);
    if (lines.length === 0 || bw > within.width || bh > within.height) return false;
    const bx = clamp(Math.floor(cx - bw / 2), within.x, within.x + within.width - bw);
    const by = clamp(Math.floor(cy - bh / 2), within.y, within.y + within.height - bh);
    if (!reserve({ x: bx, y: by, width: bw, height: bh })) return false;
    emit(lines, bx, by, bw, "center");
    return true;
  };

  type Corner = "tl" | "tr" | "bl" | "br";
  /** Places a block in a corner, inside the corner marker. It steps past a label already there. */
  const placeCorner = (source: readonly Line[], corner: Corner, limit: Box = safe): boolean => {
    const lines = fitted(source, own.width - 2 * off);
    const bw = blockWidth(lines);
    const bh = blockHeight(lines);
    if (lines.length === 0) return false;
    const top = corner === "tl" || corner === "tr";
    const left = corner === "tl" || corner === "bl";
    const bx = left ? own.x + off : own.x + own.width - off - bw;
    let by = top ? own.y + off : own.y + own.height - off - bh;
    for (let attempt = 0; attempt < 4; attempt++) {
      const box = { x: bx, y: by, width: bw, height: bh };
      if (!inside(box, safe) || !inside(box, limit)) return false;
      if (reserve(box)) {
        emit(lines, bx, by, bw, left ? "left" : "right");
        return true;
      }
      const plate = expand(box, platePad);
      const hit = placed.find((p) => hits(p, plate));
      if (!hit) return false;
      by = top ? hit.y + hit.height + platePad : hit.y - platePad - bh;
    }
    return false;
  };

  /** Tries corners in order, then the same with fewer lines. The first lines are the most important. */
  const placeInCorners = (lines: readonly Line[], corners: readonly Corner[], limit?: Box): boolean => {
    for (let n = lines.length; n >= 1; n--) {
      for (const corner of corners) if (placeCorner(lines.slice(0, n), corner, limit)) return true;
    }
    return false;
  };

  // Orientation: a solid arrow on the top edge. With the solid origin square in the top-left corner,
  // a mirrored or rotated screen is visible without reading any text.
  const arrowH = clamp(Math.round(m / 40), 4, 40);
  const arrowBase = (w % 2 === 0 ? 2 : 1) + 2 * (arrowH - 1);
  const arrowBox: Box = { x: x + (w - arrowBase) / 2, y: y + 1, width: arrowBase, height: arrowH };
  let topReserve = y + off;
  if (!blocked(arrowBox)) {
    for (let i = 0; i < arrowH; i++) {
      const rowW = (w % 2 === 0 ? 2 : 1) + 2 * i;
      layers.marks.push(rectNode(x + (w - rowW) / 2, y + 1 + i, rowW, 1, CAL_COLORS.white));
    }
    obstacles.push(arrowBox);
    const label: Line = { size: base, weight: 600, parts: [{ text: "TOP", fill: CAL_COLORS.white }] };
    const labelW = lineWidth(label);
    const labelBox: Box = { x: x + Math.floor((w - labelW) / 2), y: y + 1 + arrowH + gap, width: labelW, height: base };
    // On a compact screen the arrow stands alone.
    if (!compact && reserve(labelBox)) {
      emit([label], labelBox.x, labelBox.y, labelW, "left");
      topReserve = Math.max(topReserve, labelBox.y + base + platePad + gap);
    }
  }

  // Corner markers, inset from the edge. The top-left one carries a solid square: the origin.
  const corners: { box: Box; nodes: CalNode[] }[] = [
    {
      box: { x: x + inset, y: y + inset, width: arm, height: arm },
      nodes: [rectNode(x + inset, y + inset, arm, stroke, CAL_COLORS.white), rectNode(x + inset, y + inset, stroke, arm, CAL_COLORS.white), rectNode(x + inset, y + inset, origin, origin, s.accent)],
    },
    {
      box: { x: x + w - inset - arm, y: y + inset, width: arm, height: arm },
      nodes: [rectNode(x + w - inset - arm, y + inset, arm, stroke, CAL_COLORS.white), rectNode(x + w - inset - stroke, y + inset, stroke, arm, CAL_COLORS.white)],
    },
    {
      box: { x: x + inset, y: y + h - inset - arm, width: arm, height: arm },
      nodes: [rectNode(x + inset, y + h - inset - stroke, arm, stroke, CAL_COLORS.white), rectNode(x + inset, y + h - inset - arm, stroke, arm, CAL_COLORS.white)],
    },
    {
      box: { x: x + w - inset - arm, y: y + h - inset - arm, width: arm, height: arm },
      nodes: [rectNode(x + w - inset - arm, y + h - inset - stroke, arm, stroke, CAL_COLORS.white), rectNode(x + w - inset - stroke, y + h - inset - arm, stroke, arm, CAL_COLORS.white)],
    },
  ];
  for (const corner of corners) if (!obstacles.some((o) => hits(o, corner.box))) layers.marks.push(...corner.nodes);
  // Cabinet labels stay off the marks themselves (their lines and origin square), not the whole corner box,
  // so the first cabinet still gets its A1.
  for (const corner of corners) for (const n of corner.nodes) if (n.kind === "rect") markBoxes.push(n);
  markBoxes.push(arrowBox);
  layers.marks.push(...border);

  const tv = centered(stroke, w);
  const th = centered(stroke, h);
  const centerX = x + (w - tv) / 2;
  const centerY = y + (h - th) / 2;
  const resolution = `${w} × ${h} PX`;
  const position = `X ${s.canvasX}  Y ${s.canvasY}`;
  const output = s.output ? `${s.output.label} · ${s.output.name.toUpperCase()}` : null;
  const name = s.name.toUpperCase();

  if (!cal) {
    // Identification, as on a stage test card: corner-to-corner diagonals and two concentric circles in thin
    // white lines over the checkerboard, and a small plate in the middle: the screen's name as typed on white,
    // then its resolution and physical size on black.
    const line = Math.max(2, stroke);
    const cx = x + Math.floor(w / 2);
    const cy = y + Math.floor(h / 2);
    for (const r of [...diagonalRuns(s.rect, line, false), ...diagonalRuns(s.rect, line, true)]) layers.lines.push(rectNode(r.x, r.y, r.width, r.height, CAL_COLORS.white));
    for (const radius of [Math.floor(m * 0.45), Math.floor(m * 0.25)]) {
      if (radius > 2 * line) for (const r of ringRuns(cx, cy, radius, line)) layers.lines.push(rectNode(r.x, r.y, r.width, r.height, CAL_COLORS.white));
    }

    const size = s.physical ? `W ${metres(s.physical.widthUm)} x H ${metres(s.physical.heightUm)}` : null;
    const res = `W ${w} x H ${h}`;
    const inner: Box = { x: x + off, y: Math.max(topReserve, arrowBox.y + arrowH + gap), width: w - 2 * off, height: 0 };
    const within = obstacles.reduce((left, o) => largestRemainder(left, expand(o, gap)), { ...inner, height: y + h - off - inner.y });
    const plateLines = (text: number): Line[] => {
      const lines: Line[] = [{ size: text, weight: 700, parts: [{ text: s.name, fill: CAL_COLORS.black }] }];
      if (c.elements.metadata) {
        lines.push({ size: text, weight: 600, parts: [{ text: res, fill: CAL_COLORS.white }] });
        if (size) lines.push({ size: text, weight: 600, parts: [{ text: size, fill: CAL_COLORS.white }] });
      }
      return lines;
    };
    let placedPlate = false;
    // A ribbon reads as one line on black: name, resolution, size.
    if (compact && w >= 4 * h) {
      const rowSize = Math.min(clamp(Math.round(m * 0.36), CAL_MIN_TEXT, 64), within.height);
      const parts: Part[] = [{ text: s.name, fill: CAL_COLORS.white }];
      if (c.elements.metadata) parts.push({ text: res, fill: CAL_COLORS.white }, ...(size ? [{ text: size, fill: CAL_COLORS.white }] : []));
      const row = rowSize >= CAL_MIN_TEXT ? fitLine({ size: rowSize, weight: 600, parts }, within.width - 2 * platePad) : null;
      placedPlate = !!row && placeCentered([row], cx, cy, within);
    }
    if (!placedPlate) {
      // Every line at one size: `CAL_PLATE` of the screen, shrunk to fit before a line is shortened or dropped.
      const maxW = within.width - 2 * platePad;
      const count = plateLines(CAL_MIN_TEXT).length;
      for (let n = count; n >= 1 && !placedPlate; n--) {
        for (let text = Math.min(clamp(Math.round(t * CAL_PLATE.ratio), CAL_MIN_TEXT, CAL_PLATE.max), within.height); text >= CAL_MIN_TEXT && !placedPlate; text--) {
          const lines = plateLines(text).slice(0, n);
          if (blockWidth(lines) > maxW && text > CAL_MIN_TEXT) continue;
          const set = fitted(lines, maxW);
          if (set.length !== n || blockHeight(set) + 2 * platePad > within.height) continue;
          const plates = layers.plates.length;
          placedPlate = placeCentered(set, cx, cy, within);
          if (placedPlate) {
            // The name line sits on white, the full width of the plate, over the black plate just reserved.
            const plate = layers.plates[plates];
            const nameText = layers.text.findLast((n2) => n2.kind === "text" && n2.text === set[0].parts[0].text && n2.owner === c.index);
            if (plate && plate.kind === "rect" && nameText && nameText.kind === "text") {
              const bottom = nameText.y + nameText.height + Math.floor(lineGap(set[Math.min(1, set.length - 1)]) / 2);
              layers.plates.push(rectNode(plate.x, plate.y, plate.width, Math.min(plate.height, bottom - plate.y), CAL_COLORS.white));
            }
          }
        }
      }
    }
    // A moving card counts frames in identification too, in a corner, after the plate has its room.
    if (c.motion && c.elements.frameCounter) placeInCorners(counterLines(Math.round(base * 1.5), base, c.fps), ["tr", "bl", "br"]);
    return;
  }

  // Calibration. Center crosshair: 1 px through an odd dimension, 2 px straddling the middle of an even one.
  if (c.elements.crosshair) {
    layers.lines.push(rectNode(centerX, y, tv, h, CAL_COLORS.white), rectNode(x, centerY, w, th, CAL_COLORS.white));
    const r = clamp(Math.round(m / 24), 4, 64);
    const box: Box = { x: centerX - r, y: centerY - r, width: tv + 2 * r, height: th + 2 * r };
    layers.lines.push(rectNode(box.x, box.y, box.width, 1, CAL_COLORS.white), rectNode(box.x, box.y + box.height - 1, box.width, 1, CAL_COLORS.white), rectNode(box.x, box.y, 1, box.height, CAL_COLORS.white), rectNode(box.x + box.width - 1, box.y, 1, box.height, CAL_COLORS.white));
    obstacles.push(expand(box, gap));
  }

  // Top-left: what this screen is and where it sits.
  // The identifier is never the line that gets dropped: on a narrow screen it takes the base size.
  const title = textWidth(s.label.length, Math.round(base * 1.5)) <= w - 2 * off ? Math.round(base * 1.5) : base;
  const meta: Line[] = [{ size: title, weight: 700, parts: [{ text: s.label, fill: s.accent }, { text: name, fill: CAL_COLORS.white }] }];
  if (c.elements.metadata) {
    meta.push({ size: base, weight: 600, parts: [{ text: resolution, fill: CAL_COLORS.white }] }, { size: base, weight: 500, parts: [{ text: position, fill: CAL_COLORS.muted }] });
    if (output) meta.push({ size: base, weight: 500, parts: [{ text: output, fill: CAL_COLORS.muted }] });
    if (cab) meta.push({ size: base, weight: 500, parts: [{ text: `CAB ${cab.columns} × ${cab.rows} · ${cab.pixelsX} × ${cab.pixelsY} PX`, fill: CAL_COLORS.muted }] });
  }
  // With reference patches on, metadata keeps to the upper half so the patches own the lower one.
  const upperHalf: Box = { x: own.x, y: own.y, width: own.width, height: Math.floor(own.height / 2) - gap };
  if (!placeInCorners(meta, ["tl"], c.elements.references ? upperHalf : undefined) && c.elements.references) placeInCorners(meta, ["tl"]);

  // Reference patches: pure red, green, blue, white, black, and 1 px line pairs that show scaling.
  if (c.elements.references) {
    const lowTop = centerY + th + gap;
    const lowBottom = y + h - off;
    for (let p = sized(CAL_SCALE.patch, m), done = false; p >= CAL_SCALE.patch.min && !done; p = Math.floor(p * 0.85)) {
      const side = p - (p % 2);
      const patchGap = Math.max(2, Math.round(side / 8));
      const labelSize = clamp(Math.round(side * 0.22), CAL_MIN_TEXT, base);
      const labels = c.elements.metadata && textWidth(3, labelSize) <= side;
      const cellH = side + (labels ? Math.round(labelSize * 0.5) + labelSize : 0);
      for (const cols of [6, 3]) {
        const rows = 6 / cols;
        const totalW = cols * side + (cols - 1) * patchGap;
        const totalH = rows * cellH + (rows - 1) * patchGap;
        if (totalW > w - 2 * off || totalH > lowBottom - lowTop) continue;
        const sx = x + Math.floor((w - totalW) / 2);
        const sy = clamp(y + Math.round(h * 0.75) - Math.floor(totalH / 2), lowTop, lowBottom - totalH);
        const strip: Box = { x: sx, y: sy, width: totalW, height: totalH };
        if (!reserve(strip)) continue;
        const patches = [
          { label: "R", fill: CAL_COLORS.red },
          { label: "G", fill: CAL_COLORS.green },
          { label: "B", fill: CAL_COLORS.blue },
          { label: "W", fill: CAL_COLORS.white },
          { label: "K", fill: CAL_COLORS.black },
          { label: "1PX", fill: CAL_COLORS.black },
        ];
        patches.forEach((patch, i) => {
          const px = sx + (i % cols) * (side + patchGap);
          const py = sy + Math.floor(i / cols) * (cellH + patchGap);
          layers.marks.push(rectNode(px, py, side, side, patch.fill));
          if (patch.label === "K") {
            layers.marks.push(rectNode(px, py, side, 1, CAL_COLORS.outline), rectNode(px, py + side - 1, side, 1, CAL_COLORS.outline), rectNode(px, py, 1, side, CAL_COLORS.outline), rectNode(px + side - 1, py, 1, side, CAL_COLORS.outline));
          }
          if (patch.label === "1PX") {
            // Top half: 1 px columns. Bottom half: 1 px rows. Any scaling turns them grey or uneven.
            for (let i2 = 0; i2 < side; i2 += 2) layers.marks.push(rectNode(px + i2, py, 1, side / 2, CAL_COLORS.white));
            for (let j = 0; j < side / 2; j += 2) layers.marks.push(rectNode(px, py + side / 2 + j, side, 1, CAL_COLORS.white));
          }
          if (labels) {
            const lw = textWidth(patch.label.length, labelSize);
            layers.text.push({ kind: "text", text: patch.label, x: px + Math.floor((side - lw) / 2), y: py + side + Math.round(labelSize * 0.5), width: lw, height: labelSize, size: labelSize, weight: 600, fill: CAL_COLORS.muted, owner: c.index });
          }
        });
        done = true;
        break;
      }
    }
  }

  if (c.elements.frameCounter) placeInCorners(counterLines(title, base, c.fps), ["tr", "bl", "br"]);

  if (c.elements.metadata) {
    // Bottom-right: the screen's last pixel on the master canvas.
    placeInCorners([{ size: base, weight: 500, parts: [{ text: `X ${s.canvasX + w - 1}  Y ${s.canvasY + h - 1}`, fill: CAL_COLORS.muted }] }], ["br", "bl"]);
    if (c.elements.grid) {
      const grid = pitchX === pitchY ? `GRID ${pitchX} PX` : `GRID ${pitchX} × ${pitchY} PX`;
      placeInCorners([{ size: base, weight: 500, parts: [{ text: grid, fill: CAL_COLORS.muted }] }], ["bl", "br"]);
    }
  }
}

export function buildCalibrationFrame(input: CalibrationInput): CalibrationFrame {
  const { width, height, screens, mode } = input;
  const elements = { ...DEFAULT_ELEMENTS, ...input.elements };
  const layers: Layers = { field: [], grid: [], lines: [], plates: [], marks: [], text: [] };
  const logo = logoRect(width, height, input.logo);
  const frameBox: Box = { x: 0, y: 0, width, height };
  const keepOut = logo && input.logo.mode === "center" ? intersect(expand(logo, Math.round(logo.height * 0.25)), frameBox) : null;

  // Larger screens are drawn first. Where two screens share pixels, the smaller one owns the shared
  // area and the larger one keeps its labels out of it.
  const order = screens.map((screen, index) => ({ screen, index })).sort((a, b) => area(b.screen.rect) - area(a.screen.rect) || a.index - b.index);
  const placed: Box[] = [];
  const deferred: (() => void)[] = [];
  order.forEach(({ screen, index }, rank) => {
    const obstacles: Box[] = keepOut ? [keepOut] : [];
    for (const other of order.slice(rank + 1)) {
      const shared = intersect(screen.rect, other.screen.rect);
      if (area(shared) > 0) obstacles.push(shared);
    }
    layoutScreen(screen, { index, mode, elements, fps: input.fps, motion: input.motion === true, obstacles, logoKeepOut: keepOut, placed, layers, deferred });
  });
  for (const run of deferred) run();

  const nodes: CalNode[] = [rectNode(0, 0, width, height, CAL_COLORS.black), ...layers.field, ...layers.grid];
  // The sweep goes over the field and grid, under lines, label plates, marks, the logo and text: it never
  // hides what a screen is.
  const sweep = input.motion ? { ...sweepFor(width, input.fps, screens.map((sc) => sc.rect)), before: nodes.length } : null;
  if (logo && input.logo.mode === "watermark") nodes.push({ kind: "logo", ...logo, opacity: CAL_LOGO.watermark.opacity });
  // Appended in loops: a large wall has tens of thousands of line runs, more than a spread call takes.
  for (const layer of [layers.lines, layers.plates, layers.marks]) for (const n of layer) nodes.push(n);
  if (logo && keepOut) nodes.push(rectNode(keepOut.x, keepOut.y, keepOut.width, keepOut.height, CAL_COLORS.black), { kind: "logo", ...logo, opacity: CAL_LOGO.center.opacity });
  for (const n of layers.text) nodes.push(n);
  return { width, height, mode, nodes, logoKeepOut: keepOut, sweep };
}
