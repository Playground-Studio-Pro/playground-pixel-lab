import { depthWindow } from "@/engines/depth/camera";
import type { DepthSceneConfig } from "@/engines/depth/config";
import type { DrawOptions, FrameInput, FrameSource } from "@/preview/contract";
import { useDepth } from "./depth-store";
import { DepthRenderer } from "./renderer";

/**
 * The Depth Studio scene as a `FrameSource`, so the shared preview, full-screen output and frame export
 * can play it across the mapped screens like any Motion Lab pattern.
 *
 * It renders the scene once for the whole master canvas, with WebGL on its own off-screen canvas, and
 * copies the result into the 2D context it is given. The engine then cuts that master image into screens.
 *
 * Timing: the input frame counts at the preview's content rate, the scene loops at its own. The scene
 * frame is the one showing at the same content time, `floor(frame × sceneFps / inputFps)`, so it only
 * depends on the frame number.
 */

let shared: { canvas: HTMLCanvasElement; renderer: DepthRenderer } | null = null;
let unavailable = false;

function renderer(): DepthRenderer | null {
  if (shared) return shared.renderer;
  if (unavailable || typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    shared = { canvas, renderer: new DepthRenderer(canvas) };
    return shared.renderer;
  } catch {
    unavailable = true;
    return null;
  }
}

/** The scene frame at the same content time as `frame` at `inputFps`. */
export function sceneFrame(frame: number, inputFps: number, config: Pick<DepthSceneConfig, "fps">): number {
  return Math.floor((frame * config.fps) / inputFps + 1e-9);
}

export function drawDepthScene(ctx: CanvasRenderingContext2D, input: FrameInput, options: DrawOptions, config: DepthSceneConfig) {
  const width = Math.max(1, Math.round(input.width * options.scale));
  const height = Math.max(1, Math.round(input.height * options.scale));
  const r = renderer();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!r || !shared) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    return;
  }
  // The GPU caps the image size. Beyond it the master image is rendered smaller and scaled up, which only
  // a preview may do: export and full-screen output check `maxSize` first and refuse.
  const fit = Math.min(1, r.maxSize / Math.max(width, height));
  r.resize(Math.max(1, Math.floor(width * fit)), Math.max(1, Math.floor(height * fit)));
  r.setScene(config, depthWindow({ widthPx: input.width, heightPx: input.height, physical: null }));
  r.renderFrame(sceneFrame(input.frame, input.fps, config));
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(shared.canvas, 0, 0, width, height);
  ctx.restore();
}

export const depthSource: FrameSource = {
  id: "depth-scene",
  name: "Depth Studio scene",
  draw: (ctx, input, options) => drawDepthScene(ctx, input, options, useDepth.getState().config),
};

/** The scene with its settings fixed, for exports: editing Depth Studio during an export can't change the frames. */
export function createDepthSource(config: DepthSceneConfig): FrameSource {
  const frozen = structuredClone(config);
  return { id: "depth-scene", name: "Depth Studio scene", draw: (ctx, input, options) => drawDepthScene(ctx, input, options, frozen) };
}

/** Largest master side the scene renders at without scaling, on this GPU. Null without WebGL 2. */
export function depthMaxSize(): number | null {
  return renderer()?.maxSize ?? null;
}
