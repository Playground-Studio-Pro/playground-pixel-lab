import type { ContentFps } from "@/domain/motion";
import { counterText, sweepRects, type CalibrationFrame, type CalNode } from "./frame";
import { CAL_BASELINE } from "./tokens";

export interface CalibrationDrawOptions {
  /** Device pixels per frame pixel. Exactly 1 for exported frames and full-size output. */
  readonly scale: number;
  readonly fontFamily: string;
  /**
   * The decoded logo, or null while it loads. Drawn at the frame's logo rectangle, never stretched. A
   * `LogoRaster` hands over the logo already resized to that rectangle, drawn 1:1, so the pixels don't depend
   * on how the browser filters a scaled `drawImage` (it differs between GPU and CPU canvases).
   */
  readonly logo: CanvasImageSource | LogoRaster | null;
  readonly frame: number;
  readonly fps: ContentFps;
}

/** The logo pre-resized to an exact device size. Same size, same pixels, on any canvas. */
export interface LogoRaster {
  at(width: number, height: number): CanvasImageSource | null;
}

const isRaster = (logo: CanvasImageSource | LogoRaster): logo is LogoRaster => typeof (logo as LogoRaster).at === "function";

/** Which nodes to draw. Counters go on their own layer so playback redraws a few glyphs, not the frame. */
export type CalibrationLayer = "static" | "counters";

/**
 * Draws a calibration frame. At scale 1 every rectangle lands on exact pixels. At other scales edges
 * snap to whole device pixels and nothing gets thinner than one, so a reduced preview keeps its lines.
 */
export function drawCalibration(ctx: CanvasRenderingContext2D, frame: CalibrationFrame, options: CalibrationDrawOptions, layer: CalibrationLayer): void {
  const { scale, fontFamily } = options;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const text = (node: Extract<CalNode, { kind: "text" | "counter" }>, value: string) => {
    ctx.fillStyle = node.fill;
    ctx.font = `${node.weight} ${node.size * scale}px ${fontFamily}`;
    // The box width is the monospace advance. Passing it as a limit keeps a fallback font inside the box.
    ctx.fillText(value, Math.round(node.x * scale), Math.round((node.y + node.size * CAL_BASELINE) * scale), node.width * scale);
  };
  const rect = (r: { x: number; y: number; width: number; height: number }, fill: string) => {
    const x0 = Math.round(r.x * scale);
    const y0 = Math.round(r.y * scale);
    ctx.fillStyle = fill;
    ctx.fillRect(x0, y0, Math.max(1, Math.round((r.x + r.width) * scale) - x0), Math.max(1, Math.round((r.y + r.height) * scale) - y0));
  };
  // The sweep moves with the frame: a caller that draws the static layer once sees it at that frame only.
  const sweep = () => {
    if (frame.sweep && layer === "static") for (const r of sweepRects(frame.sweep, options.frame)) rect(r, frame.sweep.fill);
  };
  for (const [i, node] of frame.nodes.entries()) {
    if (i === frame.sweep?.before) sweep();
    if (node.kind === "counter") {
      if (layer === "counters") text(node, counterText(node.field, options.frame, options.fps));
      continue;
    }
    if (layer !== "static") continue;
    if (node.kind === "rect") {
      rect(node, node.fill);
    } else if (node.kind === "text") {
      text(node, node.text);
    } else if (options.logo) {
      const [x, y, w, h] = [Math.round(node.x * scale), Math.round(node.y * scale), Math.round(node.width * scale), Math.round(node.height * scale)];
      const image = isRaster(options.logo) ? options.logo.at(w, h) : options.logo;
      if (image) {
        ctx.globalAlpha = node.opacity;
        ctx.drawImage(image, x, y, w, h);
        ctx.globalAlpha = 1;
      }
    }
  }
  if (frame.sweep && frame.sweep.before >= frame.nodes.length) sweep();
}
