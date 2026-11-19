import type { VideoTarget } from "@/engines/video-targets";
import type { FrameInput, FrameSource } from "@/preview/contract";

/**
 * A master-canvas source as seen by one export target. The master target draws the source directly.
 * An output or screen target draws the whole master at scale 1 on its own canvas, then copies each
 * screen's master rectangle to its place in the target, pixel for pixel. Nothing is scaled, so the
 * export shows exactly the pixels the Live preview cuts out of the same master frame.
 */
export function targetSource(source: FrameSource, target: VideoTarget, master: Omit<FrameInput, "frame" | "fps">): FrameSource {
  if (!target.regions) return source;
  let canvas: HTMLCanvasElement | null = null;
  return {
    id: `${source.id}@${target.id}`,
    name: `${source.name}, ${target.label}`,
    draw(ctx, input, options) {
      if (options.scale !== 1) throw new Error("Export targets draw at scale 1 only.");
      if (input.width !== target.width || input.height !== target.height) throw new Error(`Expected ${target.width} × ${target.height}, got ${input.width} × ${input.height}.`);
      canvas ??= document.createElement("canvas");
      if (canvas.width !== master.width) canvas.width = master.width;
      if (canvas.height !== master.height) canvas.height = master.height;
      const mctx = canvas.getContext("2d", { alpha: false });
      if (!mctx) throw new Error("Unable to allocate the master canvas.");
      source.draw(mctx, { ...master, frame: input.frame, fps: input.fps }, options);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, target.width, target.height);
      for (const r of target.regions!) ctx.drawImage(canvas, r.from.x, r.from.y, r.from.width, r.from.height, r.to.x, r.to.y, r.from.width, r.from.height);
      ctx.restore();
    },
  };
}
