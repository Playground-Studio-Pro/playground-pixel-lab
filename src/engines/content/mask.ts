import type { ResolvedMapping } from "@/engines/mapping";

/**
 * Content masks, stored in `modules["mask"]`. Pure.
 *
 * At shows the LED is mapped as straight rectangles and the visible silhouette comes from a mask:
 * black outside the shape, content untouched inside. A mask belongs to a content canvas and is made of
 * polygons in that canvas's pixels. It never changes the mapping: slices, outputs and the Resolume
 * package stay the same with the mask on or off. It only changes the pixels a source draws.
 *
 * Rule for which pixels are inside: a pixel is inside when its centre is inside any polygon, each
 * polygon read even-odd. A bitmap mask (a PNG kept on this machine, not in the project) is inside where
 * its pixel is inside.
 */

export const MASK_MODULE_ID = "mask";
export const MASK_VERSION = 1;

export interface CanvasMask {
  readonly enabled: boolean;
  /** Each polygon as x, y pairs in canvas pixels. */
  readonly polygons: readonly (readonly number[])[];
}

export interface MaskData {
  readonly canvases: Readonly<Record<string, CanvasMask>>;
}

export const EMPTY_MASK: MaskData = { canvases: {} };

/** A mask image decoded on this machine: 1 where visible, in canvas pixels from the canvas origin. */
export interface MaskBitmap {
  readonly width: number;
  readonly height: number;
  readonly bits: Uint8Array;
}

const MAX_POLYGONS = 64;
const MAX_POINTS = 10_000;
const LIMIT = 1_000_000;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Checks one polygon; returns why it's refused, or null. */
export function polygonProblem(points: readonly unknown[]): string | null {
  if (points.length < 6 || points.length % 2 !== 0) return "A polygon needs at least three x, y points.";
  if (points.length > MAX_POINTS * 2) return `A polygon can have at most ${MAX_POINTS} points.`;
  if (!points.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= LIMIT)) return "Every coordinate must be a finite number of canvas pixels.";
  return null;
}

/** Strict: anything unexpected gives null, and the project opens without a mask. */
export function parseMask(data: unknown, version: number): MaskData | null {
  if (version !== MASK_VERSION || !isRecord(data) || Object.keys(data).length !== 1 || !isRecord(data.canvases)) return null;
  const canvases: Record<string, CanvasMask> = {};
  for (const [id, raw] of Object.entries(data.canvases)) {
    if (!id || !isRecord(raw) || Object.keys(raw).length !== 2 || typeof raw.enabled !== "boolean" || !Array.isArray(raw.polygons)) return null;
    if (raw.polygons.length > MAX_POLYGONS) return null;
    const polygons: number[][] = [];
    for (const p of raw.polygons) {
      if (!Array.isArray(p) || polygonProblem(p)) return null;
      polygons.push([...(p as number[])]);
    }
    canvases[id] = { enabled: raw.enabled, polygons };
  }
  return { canvases };
}

export function setCanvasMask(data: MaskData, canvasId: string, mask: CanvasMask | null): MaskData {
  const canvases = { ...data.canvases };
  if (mask === null) delete canvases[canvasId];
  else {
    if (mask.polygons.length > MAX_POLYGONS) throw new Error(`A canvas mask can have at most ${MAX_POLYGONS} polygons.`);
    for (const p of mask.polygons) {
      const problem = polygonProblem(p);
      if (problem) throw new Error(problem);
    }
    canvases[canvasId] = mask;
  }
  return { canvases };
}

/** One screen's part of a mask, in master pixels: black goes outside the shape, inside `rect` only. */
export interface ScreenMask {
  readonly screenId: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Polygons in master pixels. */
  readonly polygons: readonly (readonly number[])[];
  /** A local bitmap, placed at `origin` in master pixels. Used instead of polygons when present. */
  readonly bitmap: (MaskBitmap & { readonly origin: { readonly x: number; readonly y: number } }) | null;
}

/**
 * Which screens a mask covers, in master pixels. A canvas mask applies inside that canvas's screens
 * only, so another canvas sharing the master is never touched. Disabled masks give nothing.
 */
export function screenMasks(mapping: ResolvedMapping, mask: MaskData, bitmaps: Readonly<Record<string, MaskBitmap>> = {}): ScreenMask[] {
  const out: ScreenMask[] = [];
  for (const canvas of mapping.canvases) {
    const entry = mask.canvases[canvas.canvasId];
    const bitmap = bitmaps[canvas.canvasId];
    if (!entry?.enabled || (entry.polygons.length === 0 && !bitmap)) continue;
    const polygons = entry.polygons.map((p) => p.map((v, i) => v + (i % 2 === 0 ? canvas.originX : canvas.originY)));
    for (const s of mapping.screens) {
      if (!canvas.screenIds.includes(s.screenId)) continue;
      const r = s.masterRect;
      out.push({
        screenId: s.screenId,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        polygons,
        bitmap: bitmap ? { ...bitmap, origin: { x: canvas.originX, y: canvas.originY } } : null,
      });
    }
  }
  return out;
}

/** 1 for every pixel of `m.rect` inside the mask, 0 outside. Row-major, `rect.width` per row. */
export function rasterizeMask(m: ScreenMask): Uint8Array {
  const { x: rx, y: ry, width: W, height: H } = m.rect;
  const bits = new Uint8Array(W * H);
  if (m.bitmap) {
    const b = m.bitmap;
    for (let y = 0; y < H; y++) {
      const by = ry + y - b.origin.y;
      if (by < 0 || by >= b.height) continue;
      for (let x = 0; x < W; x++) {
        const bx = rx + x - b.origin.x;
        if (bx >= 0 && bx < b.width && b.bits[by * b.width + bx]) bits[y * W + x] = 1;
      }
    }
    return bits;
  }
  const xs: number[] = [];
  for (let y = 0; y < H; y++) {
    const cy = ry + y + 0.5;
    for (const p of m.polygons) {
      xs.length = 0;
      const n = p.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const x0 = p[j * 2], y0 = p[j * 2 + 1], x1 = p[i * 2], y1 = p[i * 2 + 1];
        if (y0 <= cy !== y1 <= cy) xs.push(x0 + ((cy - y0) * (x1 - x0)) / (y1 - y0));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // Pixel x is inside when its centre x + 0.5 is in [a, b).
        const from = Math.max(0, Math.ceil(xs[k] - 0.5 - rx));
        const to = Math.min(W, Math.ceil(xs[k + 1] - 0.5 - rx));
        if (to > from) bits.fill(1, y * W + from, y * W + to);
      }
    }
  }
  return bits;
}

/** Blacks out every pixel outside the mask and leaves every pixel inside as it was. RGBA, in place. */
export function applyMaskPixels(rgba: Uint8ClampedArray, bits: Uint8Array): void {
  if (rgba.length !== bits.length * 4) throw new Error("The mask and the image have different sizes.");
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) continue;
    const o = i * 4;
    rgba[o] = 0;
    rgba[o + 1] = 0;
    rgba[o + 2] = 0;
    rgba[o + 3] = 255;
  }
}

/** Polygons from text: one polygon per line, as `x,y x,y x,y …` in canvas pixels. */
export function parsePointsText(text: string): number[][] {
  const polygons: number[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const values = line.trim().split(/[\s,]+/).map(Number);
    const problem = polygonProblem(values);
    if (problem) throw new Error(`${problem} Line: "${line.trim().slice(0, 40)}"`);
    polygons.push(values);
  }
  if (polygons.length === 0) throw new Error("No points found. Write one polygon per line, as x,y pairs.");
  return polygons;
}

export function pointsText(polygons: readonly (readonly number[])[]): string {
  return polygons.map((p) => p.reduce<string[]>((acc, v, i) => (i % 2 ? (acc[acc.length - 1] += `,${v}`, acc) : [...acc, String(v)]), []).join(" ")).join("\n");
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];

function pathPolygons(d: string): number[][] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const polygons: number[][] = [];
  let current: number[] = [];
  let cmd = "";
  let x = 0, y = 0, sx = 0, sy = 0;
  const close = () => {
    if (current.length) polygons.push(current);
    current = [];
  };
  for (let i = 0; i < tokens.length; ) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const num = () => {
      const v = Number(tokens[i++]);
      if (!Number.isFinite(v)) throw new Error("The path has a command without its numbers.");
      return v;
    };
    switch (cmd) {
      case "M": case "m": {
        close();
        const nx = num(), ny = num();
        x = cmd === "m" ? x + nx : nx; y = cmd === "m" ? y + ny : ny;
        sx = x; sy = y;
        current.push(x, y);
        cmd = cmd === "m" ? "l" : "L";
        break;
      }
      case "L": case "l": { const nx = num(), ny = num(); x = cmd === "l" ? x + nx : nx; y = cmd === "l" ? y + ny : ny; current.push(x, y); break; }
      case "H": case "h": { const nx = num(); x = cmd === "h" ? x + nx : nx; current.push(x, y); break; }
      case "V": case "v": { const ny = num(); y = cmd === "v" ? y + ny : ny; current.push(x, y); break; }
      case "Z": case "z": close(); x = sx; y = sy; break;
      default: throw new Error(`Path command "${cmd}" isn't supported: masks take straight lines only (M, L, H, V, Z). Flatten curves first.`);
    }
  }
  close();
  return polygons;
}

/**
 * Polygons from an SVG file, in its own user units, read as canvas pixels: `polygon`, `polyline`,
 * `rect` and straight-line `path`. Transforms and curves are refused with a reason rather than guessed.
 */
export function parseSvgMask(svg: string): number[][] {
  if (!/<svg[\s>]/i.test(svg)) throw new Error("This file isn't an SVG.");
  if (/\stransform\s*=/i.test(svg)) throw new Error("The SVG uses transforms. Flatten them in your editor first, so every point is in canvas pixels.");
  const polygons: number[][] = [];
  for (const tag of svg.match(/<(polygon|polyline|rect|path)\b[^>]*>/gi) ?? []) {
    const kind = /^<(\w+)/.exec(tag)![1].toLowerCase();
    if (kind === "rect") {
      const [x, y, w, h] = ["x", "y", "width", "height"].map((n) => Number(attr(tag, n) ?? (n === "x" || n === "y" ? 0 : NaN)));
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error("A rect in the SVG has no usable size.");
      polygons.push([x, y, x + w, y, x + w, y + h, x, y + h]);
    } else if (kind === "path") {
      polygons.push(...pathPolygons(attr(tag, "d") ?? ""));
    } else {
      polygons.push((attr(tag, "points") ?? "").trim().split(/[\s,]+/).map(Number));
    }
  }
  if (polygons.length === 0) throw new Error("No polygon, polyline, rect or path found in the SVG.");
  if (polygons.length > MAX_POLYGONS) throw new Error(`The SVG has ${polygons.length} shapes; a mask takes at most ${MAX_POLYGONS}.`);
  for (const p of polygons) {
    const problem = polygonProblem(p);
    if (problem) throw new Error(problem);
  }
  return polygons;
}

/** Visible where the PNG pixel is bright and opaque: white shows, black and transparent hide. */
export function bitmapFromRgba(rgba: Uint8ClampedArray, width: number, height: number): MaskBitmap {
  const bits = new Uint8Array(width * height);
  for (let i = 0; i < bits.length; i++) {
    const o = i * 4;
    const luma = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
    bits[i] = rgba[o + 3] >= 128 && luma >= 128 ? 1 : 0;
  }
  return { width, height, bits };
}
