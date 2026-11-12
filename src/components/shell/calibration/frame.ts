import type { ContentFps } from "@/domain/motion";
import type { Rect } from "@/domain/units";
import { timecode } from "@/engines/motion/clock";
import { CAL_ADVANCE, CAL_COLORS, CAL_LOGO, CAL_MIN_TEXT, CAL_SCALE, CAL_TINT, tint } from "./tokens";

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

export interface CalibrationFrame {
  readonly width: number;
  readonly height: number;
  readonly mode: CalibrationMode;
  readonly nodes: readonly CalNode[];
  /** Area kept clear around a centered logo. Null in watermark and off modes. */
  readonly logoKeepOut: Box | null;
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
  /** Areas this screen's labels and marks must stay out of: the logo, and overlaps another screen owns. */
  readonly obstacles: Box[];
  readonly logoKeepOut: Box | null;
  /** Label plates already placed anywhere in the frame. */
  readonly placed: Box[];
  readonly layers: Layers;
}

function layoutScreen(s: CalibrationScreen, c: ScreenContext): void {
  const { x, y, width: w, height: h } = s.rect;
  if (w < 1 || h < 1) return;
  const { layers, obstacles, placed } = c;
  const cal = c.mode === "calibration";
  const m = Math.min(w, h);
  const fieldColor = cal ? CAL_COLORS.black : tint(s.accent, CAL_TINT.field);

  layers.field.push(rectNode(x, y, w, h, fieldColor));

  // Cabinet seams: 2 px straddling each seam, the last pixel of one cabinet and the first of the next.
  const cab = s.cabinet;
  const seamColor = tint(s.accent, cal ? CAL_TINT.gridSeam : CAL_TINT.seamOnField);
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
  const reserve = (box: Box): boolean => {
    if (!inside(box, safe)) return false;
    const plate = intersect(expand(box, platePad), safe);
    if (blocked(plate)) return false;
    placed.push(plate);
    layers.plates.push(rectNode(plate.x, plate.y, plate.width, plate.height, fieldColor));
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
  layers.marks.push(...border);

  const tv = centered(stroke, w);
  const th = centered(stroke, h);
  const centerX = x + (w - tv) / 2;
  const centerY = y + (h - th) / 2;
  const resolution = `${w} × ${h} PX`;
  const position = `X ${s.canvasX}  Y ${s.canvasY}`;
  const output = s.output ? `${s.output.label} · ${s.output.name.toUpperCase()}` : null;
  const name = s.name.toUpperCase();

  if (compact && !cal) {
    const inner: Box = { x: x + off, y: Math.max(y + off, arrowBox.y + arrowH + gap), width: w - 2 * off, height: 0 };
    const within = obstacles.reduce((left, o) => largestRemainder(left, expand(o, gap)), { ...inner, height: y + h - off - inner.y });
    // A ribbon reads as one line: identifier, name, resolution, position.
    const rowSize = Math.min(clamp(Math.round(m * 0.36), CAL_MIN_TEXT, 64), within.height);
    if (w >= 4 * h && rowSize >= CAL_MIN_TEXT) {
      const parts: Part[] = [{ text: s.label, fill: s.accent }];
      if (c.elements.metadata) parts.push({ text: name, fill: CAL_COLORS.white }, { text: resolution, fill: CAL_COLORS.white }, { text: position, fill: CAL_COLORS.muted });
      const row = fitLine({ size: rowSize, weight: 600, parts }, within.width);
      if (row && row.parts[0].text === s.label && placeCentered([row], x + w / 2, y + h / 2, within)) return;
    }
    const idSize = Math.min(clamp(Math.round(m * 0.2), CAL_MIN_TEXT, 40), Math.floor(within.width / (s.label.length * CAL_ADVANCE)));
    if (idSize >= CAL_MIN_TEXT) {
      const sub = Math.max(CAL_MIN_TEXT, Math.round(idSize * 0.6));
      const lines: Line[] = [{ size: idSize, weight: 700, parts: [{ text: s.label, fill: s.accent }] }];
      if (c.elements.metadata) {
        lines.push({ size: sub, weight: 600, parts: [{ text: name, fill: CAL_COLORS.white }] }, { size: sub, weight: 600, parts: [{ text: resolution, fill: CAL_COLORS.white }] }, { size: sub, weight: 500, parts: [{ text: position, fill: CAL_COLORS.muted }] });
      }
      for (let n = lines.length; n >= 1; n--) {
        if (placeCentered(fitted(lines.slice(0, n), within.width), x + w / 2, y + h / 2, within)) break;
      }
    }
    return;
  }

  if (!cal) {
    // Identification: the identifier above center, the technical data below, and the center left
    // free for a small center mark or the logo.
    const markArm = clamp(Math.round(m / 48), 3, 24);
    const markBox: Box = { x: centerX - markArm, y: centerY - markArm, width: tv + 2 * markArm, height: th + 2 * markArm };
    if (!blocked(markBox)) {
      layers.marks.push(rectNode(centerX, centerY - markArm, tv, th + 2 * markArm, CAL_COLORS.white), rectNode(centerX - markArm, centerY, tv + 2 * markArm, th, CAL_COLORS.white));
      obstacles.push(markBox);
    }
    const centerGap = markArm + 2 * gap;
    const innerX = x + off;
    const innerW = w - 2 * off;
    const upperTop = topReserve;
    const upper: Box = { x: innerX, y: upperTop, width: innerW, height: centerY - centerGap - upperTop };
    const lowerTop = centerY + th + centerGap;
    const lower: Box = { x: innerX, y: lowerTop, width: innerW, height: y + h - off - lowerTop };
    const clear = (from: Box) => obstacles.reduce((left, o) => largestRemainder(left, expand(o, gap)), from);

    const upperArea = clear(upper);
    const idCap = sized(CAL_SCALE.id, t);
    const idWidthCap = Math.floor(upperArea.width / (s.label.length * CAL_ADVANCE));
    const idLines = (size: number, withName: boolean): Line[] => {
      const lines: Line[] = [{ size, weight: 700, parts: [{ text: s.label, fill: s.accent }] }];
      const nameSize = Math.round(size * 0.34);
      if (withName && c.elements.metadata && nameSize >= CAL_MIN_TEXT) lines.push({ size: nameSize, weight: 600, parts: [{ text: name, fill: CAL_COLORS.white }] });
      return fitted(lines, upperArea.width);
    };
    for (const withName of [true, false]) {
      let size = Math.min(idCap, idWidthCap, Math.floor(upperArea.height / (withName ? 1.5 : 1)));
      while (size >= CAL_MIN_TEXT && blockHeight(idLines(size, withName)) > upperArea.height) size--;
      if (size < CAL_MIN_TEXT) continue;
      if (placeCentered(idLines(size, withName), upper.x + upper.width / 2, upper.y + upper.height / 2, upperArea)) break;
    }

    if (c.elements.metadata) {
      const lowerArea = clear(lower);
      const metaSize = Math.min(sized(CAL_SCALE.idMeta, t), Math.floor(lowerArea.width / (Math.max(resolution.length, position.length) * CAL_ADVANCE)));
      if (metaSize >= CAL_MIN_TEXT) {
        const meta: Line[] = [
          { size: metaSize, weight: 600, parts: [{ text: resolution, fill: CAL_COLORS.white }] },
          { size: metaSize, weight: 500, parts: [{ text: position, fill: CAL_COLORS.muted }] },
        ];
        if (output) meta.push({ size: metaSize, weight: 500, parts: [{ text: output, fill: CAL_COLORS.muted }] });
        const lines = fitted(meta, lowerArea.width);
        for (let n = lines.length; n >= 1; n--) {
          if (placeCentered(lines.slice(0, n), lower.x + lower.width / 2, lower.y + lower.height / 2, lowerArea)) break;
        }
      }
    }
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

  if (c.elements.frameCounter) {
    const counter: Line[] = [
      { size: title, weight: 700, parts: [{ text: "0".repeat(COUNTER_CHARS.frame), fill: CAL_COLORS.white, counter: "frame" }] },
      { size: base, weight: 600, parts: [{ text: "0".repeat(COUNTER_CHARS.timecode), fill: CAL_COLORS.white, counter: "timecode" }] },
      { size: base, weight: 500, parts: [{ text: `CONTENT ${c.fps} FPS`, fill: CAL_COLORS.muted }] },
    ];
    placeInCorners(counter, ["tr", "bl", "br"]);
  }

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
  order.forEach(({ screen, index }, rank) => {
    const obstacles: Box[] = keepOut ? [keepOut] : [];
    for (const other of order.slice(rank + 1)) {
      const shared = intersect(screen.rect, other.screen.rect);
      if (area(shared) > 0) obstacles.push(shared);
    }
    layoutScreen(screen, { index, mode, elements, fps: input.fps, obstacles, logoKeepOut: keepOut, placed, layers });
  });

  const nodes: CalNode[] = [rectNode(0, 0, width, height, CAL_COLORS.black), ...layers.field, ...layers.grid];
  if (logo && input.logo.mode === "watermark") nodes.push({ kind: "logo", ...logo, opacity: CAL_LOGO.watermark.opacity });
  nodes.push(...layers.lines, ...layers.plates, ...layers.marks);
  if (logo && keepOut) nodes.push(rectNode(keepOut.x, keepOut.y, keepOut.width, keepOut.height, CAL_COLORS.black), { kind: "logo", ...logo, opacity: CAL_LOGO.center.opacity });
  nodes.push(...layers.text);
  return { width, height, mode, nodes, logoKeepOut: keepOut };
}
