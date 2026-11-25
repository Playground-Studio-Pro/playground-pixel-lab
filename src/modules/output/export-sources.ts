import { OUTPUT_SOURCE_IDS, type OutputSourceId, type Size } from "@/domain/physical-output";
import { auroraLoopSeconds, type AuroraSpeed } from "@/engines/content/aurora";
import type { WallBuildSettings } from "@/engines/content/wall-build/settings";
import { prepareWallBuildSource, WALL_BUILD_SOURCE_ID } from "@/modules/content/wall-build-source";
import { useWallBuild } from "@/modules/content/wall-build-store";
import type { FrameSource } from "@/preview/contract";
import { createOutputSource, frozenSettings } from "./output-sources";

/**
 * What the MP4 export can play: the output window's sources, plus content that is only exported. The output
 * window's own list (`OUTPUT_SOURCE_IDS`) doesn't change, so a source here can't reach a monitor by this path.
 */
export const EXPORT_ONLY_SOURCE_IDS = [WALL_BUILD_SOURCE_ID] as const;
export type ExportSourceId = OutputSourceId | (typeof EXPORT_ONLY_SOURCE_IDS)[number];
export const EXPORT_SOURCE_IDS: readonly ExportSourceId[] = [...OUTPUT_SOURCE_IDS, ...EXPORT_ONLY_SOURCE_IDS];

/** The source's part of an exported file's name. */
const FILE_LABELS: Readonly<Record<ExportSourceId, string>> = {
  "calibration-test-card": "calibration",
  "pixel-grid": "pixel-grid",
  "depth-scene": "depth",
  "content-flow": "content-flow",
  "aurora-gradient": "aurora",
  "wall-build": "wall-build",
};

export function exportSourceLabel(id: ExportSourceId): string {
  return FILE_LABELS[id];
}

export function exportSourceId(id: string): ExportSourceId | null {
  return EXPORT_SOURCE_IDS.find((s) => s === id) ?? null;
}

/** Motion Lab patterns that play in the output window and export: what the Live preview plays as a pattern. */
export const PATTERN_SOURCES = [
  { id: "content-flow", pattern: "flow", name: "Content Flow" },
  { id: "aurora-gradient", pattern: "aurora", name: "Aurora Gradient" },
] as const;

/** The Export panel's source for what the Live preview is playing, if it can be exported. */
export function exportSourceForPreview(sourceId: string | null, pattern: string): ExportSourceId | null {
  if (sourceId) return exportSourceId(sourceId);
  return PATTERN_SOURCES.find((p) => p.pattern === pattern)?.id ?? null;
}

/**
 * Whether a pattern's file loops seamlessly, and why, for the Export panel. Aurora repeats exactly every
 * 20 s ÷ flow speed; Content Flow's motions have unrelated periods and never repeat exactly.
 */
export function patternLoopNote(id: "content-flow" | "aurora-gradient", seconds: number, fps: number, auroraSpeed: AuroraSpeed): string {
  if (id === "content-flow") return "Content Flow never repeats exactly, so the file won't loop seamlessly. Its waves and glows cross every screen edge, to check continuity.";
  const loop = auroraLoopSeconds(auroraSpeed);
  // Whole frames: the loop closes on a frame boundary only when loop × fps is a whole number of frames.
  const frames = loop * fps;
  if (Number.isInteger(frames) && Number.isInteger((seconds * fps) / frames)) return `Loops seamlessly: the picture repeats every ${loop} s at ${auroraSpeed}× flow speed.`;
  return `The picture repeats every ${loop} s at ${auroraSpeed}× flow speed, so a ${seconds} s file won't loop seamlessly. Use a multiple of ${loop} s.`;
}

/** Wall Build with fixed settings. It never reads the store, and never draws before its engine is loaded. */
export async function createWallBuildExportSource(settings: WallBuildSettings): Promise<FrameSource> {
  await prepareWallBuildSource();
  const { drawWallBuild } = await import("@/modules/content/wall-build-draw");
  return {
    id: WALL_BUILD_SOURCE_ID,
    name: "Wall Build",
    draw(ctx, input, { scale }) {
      if (!input.context) throw new Error("Wall Build needs the resolved mapping to export.");
      drawWallBuild(ctx, input, scale, settings);
    },
  };
}

/** The source as it will be exported. Its settings are read before anything is awaited, so later edits can't reach it. */
export function createExportSource(sourceId: string, master: Size): Promise<FrameSource> {
  const id = exportSourceId(sourceId);
  if (!id) return Promise.reject(new Error(`"${sourceId}" can't be exported.`));
  if (id === WALL_BUILD_SOURCE_ID) return createWallBuildExportSource({ ...useWallBuild.getState().settings });
  return createOutputSource(id, frozenSettings(id), master);
}
