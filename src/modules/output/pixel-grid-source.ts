import { motionMarkerOp, patternWhite, pixelGridOps, type GridLabel, type GridOp, type GridPattern, type GridSize, type Rgb } from "@/engines/pixel-grid";
import type { FrameInput, FrameSource } from "@/preview/contract";

/**
 * The pixel-grid test card as a `FrameSource` (PHYSICAL_OUTPUT 8.7): drawn on the master canvas inside each
 * screen's `masterRect`, then cut by the mapping like any source, so a 1:1 output or MP4 shows each screen's
 * grid with its edges on the screen's first and last pixels.
 *
 * Geometry comes from `engines/pixel-grid.ts`; this file only paints it. At scale 1 every rectangle lands on
 * whole pixels and nothing is smoothed. Text uses a system monospace face, so there is nothing to load and the
 * first frame is the same as every other.
 */

/** Frozen settings, as an output session carries them (8.5). `display` space is drawn by the output page. */
export interface PixelGridSettings {
  readonly space: "master" | "display";
  readonly motion: boolean;
}

export const PIXEL_GRID_SOURCE_ID = "pixel-grid";
const FONT = "11px Menlo, ui-monospace, SFMono-Regular, Consolas, monospace";

const css = ([r, g, b]: Rgb) => `rgb(${r},${g},${b})`;

const patterns = new WeakMap<CanvasRenderingContext2D, Map<GridPattern, CanvasPattern | null>>();

function patternFor(ctx: CanvasRenderingContext2D, kind: GridPattern): CanvasPattern | null {
  let map = patterns.get(ctx);
  if (!map) patterns.set(ctx, (map = new Map()));
  if (map.has(kind)) return map.get(kind)!;
  const size = kind === "checker-2" ? 4 : 2;
  const tile = document.createElement("canvas");
  tile.width = tile.height = size;
  const t = tile.getContext("2d", { alpha: false })!;
  const img = t.createImageData(size, size);
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const i = (v * size + u) * 4;
      const c = patternWhite(kind, u, v) ? 255 : 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  t.putImageData(img, 0, 0);
  const pattern = ctx.createPattern(tile, "repeat");
  map.set(kind, pattern);
  return pattern;
}

function paint(ctx: CanvasRenderingContext2D, ops: readonly GridOp[]) {
  for (const op of ops) {
    if (op.kind === "rect") {
      ctx.fillStyle = css(op.color);
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.kind === "pattern") {
      const pattern = patternFor(ctx, op.pattern);
      if (!pattern) continue;
      pattern.setTransform(new DOMMatrix([1, 0, 0, 1, op.x, op.y]));
      ctx.fillStyle = pattern;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else {
      ctx.fillStyle = "#000";
      ctx.fillRect(op.x, op.y, op.w, op.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(op.x, op.y, op.w, op.h);
      ctx.clip();
      ctx.fillStyle = "#fff";
      ctx.fillText(op.text, op.x + 2, op.y + 2);
      ctx.restore();
    }
  }
}

/**
 * Paints one grid rectangle with its top-left at (x, y) in the context's units, at `scale` device px per unit.
 * The output page uses it for `display` space, on the whole framebuffer at scale 1.
 */
export function drawPixelGridRect(ctx: CanvasRenderingContext2D, x: number, y: number, size: GridSize, label: GridLabel, motionFrame: number | null, scale: number, ops = pixelGridOps(size, label, { motionFrame: null })) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, x * scale, y * scale);
  ctx.beginPath();
  ctx.rect(0, 0, size.w, size.h);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  paint(ctx, ops);
  const motion = motionFrame === null ? null : motionMarkerOp(size, motionFrame);
  if (motion) paint(ctx, [motion]);
  ctx.restore();
}

interface Region {
  readonly x: number;
  readonly y: number;
  readonly size: GridSize;
  readonly label: GridLabel;
}

/** Each screen's master rectangle, labelled from the mapping when the input carries it. */
function regions(input: FrameInput): Region[] {
  const mapping = input.context?.mapping;
  if (mapping && mapping.master.width === input.width && mapping.master.height === input.height) {
    return mapping.screens.map((s) => {
      const r = s.masterRect;
      const title = `${s.name} · ${r.width} × ${r.height} · master ${r.x},${r.y} · out ${s.outputRect.x},${s.outputRect.y}`;
      return { x: r.x, y: r.y, size: { w: r.width, h: r.height }, label: { originX: r.x, originY: r.y, title } };
    });
  }
  return input.screens.map((s) => ({
    x: s.x,
    y: s.y,
    size: { w: s.width, h: s.height },
    label: { originX: s.x, originY: s.y, title: `${s.name} · ${s.width} × ${s.height} · master ${s.x},${s.y}` },
  }));
}

/** Static ops per rectangle, reused while the mapping is the same. Only the motion marker changes per frame. */
let cache: { key: unknown; ops: GridOp[][] } | null = null;

function drawGrid(ctx: CanvasRenderingContext2D, input: FrameInput, scale: number, settings: PixelGridSettings) {
  const list = regions(input);
  const key = input.context?.mapping ?? input.screens;
  if (!cache || cache.key !== key || cache.ops.length !== list.length) cache = { key, ops: list.map((r) => pixelGridOps(r.size, r.label, { motionFrame: null })) };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Master pixels no screen covers stay black, as on the wall.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, Math.ceil(input.width * scale), Math.ceil(input.height * scale));
  ctx.restore();
  list.forEach((r, i) => drawPixelGridRect(ctx, r.x, r.y, r.size, r.label, settings.motion ? input.frame : null, scale, cache!.ops[i]));
}

/** The grid with its settings fixed, for exports and the output window. Master space only. */
export function createPixelGridSource(settings: PixelGridSettings): FrameSource {
  if (settings.space !== "master") throw new Error("Display space is drawn by the output page, not as a master-canvas source.");
  const frozen = Object.freeze({ ...settings });
  return { id: PIXEL_GRID_SOURCE_ID, name: "Pixel grid", draw: (ctx, input, { scale }) => drawGrid(ctx, input, scale, frozen) };
}

/** The Live preview's grid: master space, motion marker on. It has no controls, so it is the same as the export's. */
export const PIXEL_GRID_LIVE_SETTINGS: PixelGridSettings = Object.freeze({ space: "master", motion: true });
export const pixelGridSource: FrameSource = createPixelGridSource(PIXEL_GRID_LIVE_SETTINGS);
