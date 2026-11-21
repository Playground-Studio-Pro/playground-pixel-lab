import type { Project } from "@/domain/model";
import type { ContentFps } from "@/domain/motion";
import type { OutputRenderErrorCode, OutputWindowSession, Size } from "@/domain/physical-output";
import { resolveMapping, type ResolvedMapping } from "@/engines/mapping";
import { pixelGridOps } from "@/engines/pixel-grid";
import { videoTargets, type VideoTarget } from "@/engines/video-targets";
import { parseProjectFile } from "@/persistence/schema";
import type { FrameInput, FrameSource } from "@/preview/contract";
import { createOutputSource, OutputSourceError, parseOutputSettings } from "./output-sources";
import { drawPixelGridRect } from "./pixel-grid-source";
import { targetSource } from "./target-source";

/**
 * Preparing an output session (PHYSICAL_OUTPUT 8.1): everything the output window does with a session before it
 * may draw it. One mapping path, the MP4 export's: `parseProjectFile` → `resolveMapping` → `videoTargets` →
 * `targetSource(source, target, master)`. No coordinate is computed here.
 *
 * A session that fails any step is refused with a report code and never drawn; the runtime keeps the previous
 * one on screen.
 */

/** Canvas limits a session must fit; never scaled to fit (8.2, 8.9). */
export interface CanvasLimits {
  readonly maxCanvasSide: number;
  readonly maxCanvasArea: number;
}

/** Chromium's 2D canvas limits (8.9). O8 confirms them in Electron. */
export const CHROMIUM_CANVAS_LIMITS: CanvasLimits = { maxCanvasSide: 32_767, maxCanvasArea: 268_435_456 };

export class OutputSessionError extends Error {
  constructor(
    readonly code: OutputRenderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OutputSessionError";
  }
}

/** Draws one content frame onto the visible canvas, whose backing store is `canvasPx`. */
export type OutputDraw = (ctx: CanvasRenderingContext2D, frame: number, fps: ContentFps, canvasPx: Size) => void;

export interface PreparedSession {
  readonly revision: number;
  readonly project: Project;
  readonly mapping: ResolvedMapping;
  readonly target: VideoTarget;
  readonly master: Omit<FrameInput, "frame" | "fps">;
  readonly sourceId: string;
  /** The session's frozen source settings, as sent. */
  readonly sourceSettings: OutputWindowSession["source"]["settings"];
  /** The source draws with WebGL (Depth Studio): a lost GPU context stops it until the context is back. */
  readonly usesGpu: boolean;
  readonly draw: OutputDraw;
}

export interface PrepareEnv {
  readonly limits: CanvasLimits;
  readonly createSource: (id: string, settings: OutputWindowSession["source"]["settings"], master: Size) => Promise<FrameSource>;
}

const DEFAULT_ENV: PrepareEnv = { limits: CHROMIUM_CANVAS_LIMITS, createSource: createOutputSource };

function fits(size: Size, limits: CanvasLimits): boolean {
  return size.width <= limits.maxCanvasSide && size.height <= limits.maxCanvasSide && size.width * size.height <= limits.maxCanvasArea;
}

export async function prepareSession(session: OutputWindowSession, overrides: Partial<PrepareEnv> = {}): Promise<PreparedSession> {
  const env: PrepareEnv = { ...DEFAULT_ENV, ...overrides };
  let project: Project;
  try {
    project = parseProjectFile(session.projectText);
  } catch (error) {
    throw new OutputSessionError("PROJECT_INVALID", error instanceof Error ? error.message : "The project in this session can't be read.");
  }
  const mapping = resolveMapping(project);
  if (!mapping.outputs.some((o) => o.outputId === session.outputId)) {
    throw new OutputSessionError("UNKNOWN_OUTPUT", `Output "${session.outputId}" isn't in this project.`);
  }
  // A screen of this output that the mapping can't place means the wall would be missing pixels: refuse.
  const ofThisOutput = new Set(project.output.slices.filter((s) => s.outputId === session.outputId).map((s) => s.screenId));
  const missing = mapping.unresolved.filter((u) => ofThisOutput.has(u.screenId));
  if (missing.length) {
    throw new OutputSessionError("PROJECT_INVALID", `${missing.map((u) => u.name).join(", ")} can't be placed on this output (${missing[0].reason}).`);
  }
  const target = videoTargets(mapping).find((t) => t.kind === "output" && t.id === session.outputId);
  if (!target || !target.regions) throw new OutputSessionError("UNKNOWN_OUTPUT", `Output "${session.outputId}" has no target in this mapping.`);

  const master: Omit<FrameInput, "frame" | "fps"> = {
    width: mapping.master.width,
    height: mapping.master.height,
    screens: mapping.screens.map((s) => ({ id: s.screenId, name: s.name, x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height })),
    context: { project, mapping },
  };
  for (const [what, size] of [
    ["master canvas", { width: master.width, height: master.height }],
    ["display", session.display.devicePx],
  ] as const) {
    if (!fits(size, env.limits)) {
      throw new OutputSessionError("MASTER_TOO_LARGE", `The ${what} (${size.width} × ${size.height} px) is over this window's canvas limit (${env.limits.maxCanvasSide} px a side, ${env.limits.maxCanvasArea} px in all). It is never scaled down.`);
    }
  }

  const { id, settings } = session.source;
  try {
    const parsed = parseOutputSettings(id, settings);
    // The pixel grid in display space is drawn by the output page over the whole framebuffer, from device
    // pixel (0, 0), not cut from the master (8.7).
    if (parsed.id === "pixel-grid" && parsed.settings.space === "display") {
      const motion = parsed.settings.motion;
      let ops: { key: string; value: ReturnType<typeof pixelGridOps> } | null = null;
      const draw: OutputDraw = (ctx, frame, _fps, canvasPx) => {
        const size = { w: canvasPx.width, h: canvasPx.height };
        const label = { originX: 0, originY: 0, title: `Display · ${size.w} × ${size.h} px` };
        const key = `${size.w}x${size.h}`;
        if (ops?.key !== key) ops = { key, value: pixelGridOps(size, label, { motionFrame: null }) };
        drawPixelGridRect(ctx, 0, 0, size, label, motion ? frame : null, 1, ops.value);
      };
      return { revision: session.revision, project, mapping, target, master, sourceId: id, sourceSettings: settings, usesGpu: id === "depth-scene", draw };
    }
    const source = await env.createSource(id, settings, { width: master.width, height: master.height });
    const composed = targetSource(source, target, master);
    const draw: OutputDraw = (ctx, frame, fps) => composed.draw(ctx, { ...master, width: target.width, height: target.height, frame, fps }, { scale: 1, fontFamily: "sans-serif" });
    return { revision: session.revision, project, mapping, target, master, sourceId: id, sourceSettings: settings, usesGpu: id === "depth-scene", draw };
  } catch (error) {
    if (error instanceof OutputSourceError) throw new OutputSessionError(error.code, error.message);
    throw new OutputSessionError("DRAW_FAILED", error instanceof Error ? error.message : String(error));
  }
}
