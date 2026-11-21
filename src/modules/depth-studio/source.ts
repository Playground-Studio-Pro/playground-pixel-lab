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
let contextLost = false;
const contextListeners = new Set<(lost: boolean) => void>();

function onContextChange(lost: boolean) {
  contextLost = lost;
  for (const listener of contextListeners) listener(lost);
}

function renderer(): DepthRenderer | null {
  if (shared) return shared.renderer;
  if (unavailable || typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    shared = { canvas, renderer: new DepthRenderer(canvas, onContextChange) };
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

/** True while the GPU has taken the scene's WebGL context away (the renderer asks for it back). */
export function depthContextLost(): boolean {
  return contextLost;
}

/** Calls back with `true` when the context is lost and `false` once it is restored and the scene rebuilt. */
export function onDepthContextChange(listener: (lost: boolean) => void): () => void {
  contextListeners.add(listener);
  return () => void contextListeners.delete(listener);
}

/**
 * Test only (hidden smoke runs, through the output page's testMode hooks): loses or restores the scene's WebGL
 * context with WEBGL_lose_context, as a GPU reset would. Returns false when there's no context or extension.
 */
let loseExtension: WEBGL_lose_context | null = null;

export function simulateDepthContextLoss(lose: boolean): boolean {
  if (!shared) return false;
  // Kept from the first call: on a lost context getExtension returns null, so restore needs the same object.
  if (!loseExtension) loseExtension = shared.canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context") ?? null;
  if (!loseExtension) return false;
  if (lose) loseExtension.loseContext();
  else loseExtension.restoreContext();
  return true;
}
