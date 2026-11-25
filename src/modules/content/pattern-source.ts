import type { PatternId } from "@/domain/motion";
import { renderPattern, type PatternOptions } from "@/engines/motion/patterns";
import { drawPattern } from "@/preview/draw-pattern";
import type { FrameSource } from "@/preview/contract";

/**
 * A Motion Lab pattern as a source for the output window and MP4 export, with its settings fixed. It draws
 * exactly what the Live preview draws for the same frame: the same `renderPattern` and `drawPattern`, at scale 1.
 * Content Engineering wrote this for Content Flow and Aurora Gradient.
 */
export function createPatternSource(id: string, name: string, pattern: PatternId, options: PatternOptions): FrameSource {
  const frozen: PatternOptions = structuredClone(options);
  return {
    id,
    name,
    draw: (ctx, input, { scale, fontFamily }) => drawPattern(ctx, renderPattern(pattern, input, frozen), scale, fontFamily),
  };
}
