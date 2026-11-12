import type { StudioId } from "./contract";

/**
 * What the shell needs to know about studios and modules before any of them load. Plain data with no
 * imports, so it costs nothing in the initial bundle. The modules themselves are in `registry.ts`, which
 * is only imported from code that loads on first use. `tests/modules.test.ts` keeps the two in step.
 */

export interface StudioInfo {
  readonly id: StudioId;
  readonly name: string;
  readonly description: string;
}

export const STUDIOS: readonly StudioInfo[] = [
  { id: "mapping", name: "Mapping", description: "Screens, cabinets, canvases and outputs, pixel-exact" },
  { id: "content", name: "Content", description: "Content made for the mapped screens" },
  { id: "engineering", name: "Engineering", description: "Processors, cabinets, capacity, power and weight" },
  { id: "output", name: "Output", description: "Test cards, full-screen output, reports and exports" },
];

/** A `FrameSource` from a module, as the Live preview's source menu lists it. */
export interface SourceInfo {
  readonly id: string;
  readonly name: string;
  readonly moduleId: string;
  /** What it helps check or show, as `PATTERNS` describes Motion Lab patterns. */
  readonly checks: string;
}

export const MODULE_SOURCES: readonly SourceInfo[] = [
  { id: "calibration-test-card", name: "Calibration test card", moduleId: "output", checks: "Resolution, identity, alignment, color and motion of every screen" },
  { id: "depth-scene", name: "Depth Studio scene", moduleId: "depth-studio", checks: "The current depth scene, played across every mapped screen" },
];
