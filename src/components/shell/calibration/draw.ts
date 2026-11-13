import type { ContentFps } from "@/domain/motion";
import { counterText, type CalibrationFrame, type CalNode } from "./frame";
import { CAL_BASELINE } from "./tokens";

export interface CalibrationDrawOptions {
  /** Device pixels per frame pixel. Exactly 1 for exported frames and full-size output. */
  readonly scale: number;
  readonly fontFamily: string;
  /** The decoded logo, or null while it loads. Drawn at the frame's logo rectangle, never stretched. */
  readonly logo: CanvasImageSource | null;
  readonly frame: number;
  readonly fps: ContentFps;
}

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
  for (const node of frame.nodes) {
    if (node.kind === "counter") {
      if (layer === "counters") text(node, counterText(node.field, options.frame, options.fps));
      continue;
    }
    if (layer !== "static") continue;
    if (node.kind === "rect") {
      const x0 = Math.round(node.x * scale);
      const y0 = Math.round(node.y * scale);
      ctx.fillStyle = node.fill;
      ctx.fillRect(x0, y0, Math.max(1, Math.round((node.x + node.width) * scale) - x0), Math.max(1, Math.round((node.y + node.height) * scale) - y0));
    } else if (node.kind === "text") {
      text(node, node.text);
    } else if (options.logo) {
      ctx.globalAlpha = node.opacity;
      ctx.drawImage(options.logo, Math.round(node.x * scale), Math.round(node.y * scale), Math.round(node.width * scale), Math.round(node.height * scale));
      ctx.globalAlpha = 1;
    }
  }
}
