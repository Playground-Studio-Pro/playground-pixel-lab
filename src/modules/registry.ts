import type { ExportEntry } from "@/exports/contract";
import type { FrameSource } from "@/preview/contract";
import type { PixelLabModule, StudioId } from "./contract";
import { depthStudioModule } from "./depth-studio/module";
import { engineeringModule } from "./engineering/module";
import { outputModule } from "./output/module";

/**
 * Every module, listed in code. Owned by the Lead Architect.
 *
 * Each lane owns its own `module.ts` and changes what its module declares there, so this list doesn't
 * change when a module grows. Import this file only from code that loads on first use: the shell reads
 * `catalog.ts` instead, so modules never land in the initial bundle.
 */
export const MODULES: readonly PixelLabModule[] = [depthStudioModule, engineeringModule, outputModule];

export function modulesFor(studio: StudioId): readonly PixelLabModule[] {
  return MODULES.filter((m) => m.studio === studio);
}

export function findSource(id: string): FrameSource | null {
  for (const m of MODULES) {
    const source = m.sources?.find((s) => s.id === id);
    if (source) return source;
  }
  return null;
}

export function moduleExports(): readonly ExportEntry[] {
  return MODULES.flatMap((m) => m.exports ?? []);
}
