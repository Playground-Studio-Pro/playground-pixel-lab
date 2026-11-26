import { PATTERNS, type PatternId } from "@/domain/motion";
import type { Project } from "@/domain/model";
import { MASK_MODULE_ID, parseMask, screenMasks, EMPTY_MASK, type MaskBitmap, type MaskData } from "@/engines/content/mask";
import { activeScene, EMPTY_SCENES, parseScenes, SCENES_MODULE_ID, type ScenesData } from "@/engines/content/scenes";
import type { ResolvedMapping } from "@/engines/mapping";
import { renderPattern, type PatternOptions } from "@/engines/motion/patterns";
import type { FrameSource } from "@/preview/contract";
import { drawPattern } from "@/preview/draw-pattern";
import { composeScene, maskSource } from "@/preview/scene-source";
import { readModuleData } from "@/modules/module-data";

/** Live preview source ids: a pattern id, or `source:<id>` for a module source. */
export const SOURCE_PREFIX = "source:";

export function readScenes(project: Project): ScenesData {
  return readModuleData(project, SCENES_MODULE_ID, parseScenes) ?? EMPTY_SCENES;
}

export function readMask(project: Project): MaskData {
  return readModuleData(project, MASK_MODULE_ID, parseMask) ?? EMPTY_MASK;
}

/** A pattern as a source. `options` is read on every draw, so the Live preview follows its controls. */
export function patternSource(pattern: PatternId, options: () => PatternOptions = () => ({})): FrameSource {
  const name = PATTERNS.find((p) => p.id === pattern)?.name ?? pattern;
  return { id: pattern, name, draw: (ctx, input, { scale, fontFamily }) => drawPattern(ctx, renderPattern(pattern, input, options()), scale, fontFamily) };
}

export interface SourceResolver {
  readonly findSource: (id: string) => FrameSource | null;
  readonly options?: () => PatternOptions;
}

export function resolveSourceId(id: string, r: SourceResolver): FrameSource | null {
  if (id.startsWith(SOURCE_PREFIX)) return r.findSource(id.slice(SOURCE_PREFIX.length));
  return PATTERNS.some((p) => p.id === id) ? patternSource(id as PatternId, r.options) : null;
}

/** The active scene as one source, or null when no scene is active or its base can't be found. */
export function sceneSource(scenes: ScenesData, r: SourceResolver): FrameSource | null {
  const scene = activeScene(scenes);
  if (!scene) return null;
  const base = resolveSourceId(scene.base, r);
  if (!base) return null;
  const overrides = scene.overrides.flatMap((o) => {
    const source = resolveSourceId(o.sourceId, r);
    return source ? [{ screenId: o.screenId, source }] : [];
  });
  return composeScene(base, overrides);
}

/** `source` with the project's enabled canvas masks applied. The same source back when no mask is on. */
export function withMask(source: FrameSource, mapping: ResolvedMapping, mask: MaskData, bitmaps: Readonly<Record<string, MaskBitmap>> = {}): FrameSource {
  return maskSource(source, screenMasks(mapping, mask, bitmaps));
}

export function hasActiveMask(mapping: ResolvedMapping, mask: MaskData, bitmaps: Readonly<Record<string, MaskBitmap>> = {}): boolean {
  return screenMasks(mapping, mask, bitmaps).length > 0;
}

/**
 * The active scene with every part fixed now, for an export: module sources through `freeze` (the export's
 * own frozen sources), patterns with their settings copied. Null when no scene is active.
 */
export async function frozenSceneSource(scenes: ScenesData, freeze: (moduleSourceId: string) => Promise<FrameSource>, options: PatternOptions): Promise<FrameSource | null> {
  const scene = activeScene(scenes);
  if (!scene) return null;
  const fixed = structuredClone(options);
  const ids = [scene.base, ...scene.overrides.map((o) => o.sourceId)].filter((id) => id.startsWith(SOURCE_PREFIX));
  const frozen = new Map<string, FrameSource>();
  for (const id of ids) if (!frozen.has(id)) frozen.set(id, await freeze(id.slice(SOURCE_PREFIX.length)));
  const source = sceneSource(scenes, { findSource: (id) => frozen.get(SOURCE_PREFIX + id) ?? null, options: () => fixed });
  if (!source) throw new Error(`The scene "${scene.name}" has a base that can't be exported.`);
  return source;
}
