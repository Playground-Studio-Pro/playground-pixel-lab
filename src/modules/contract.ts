import type { ComponentType } from "react";
import type { ExportEntry } from "@/exports/contract";
import type { FrameSource } from "@/preview/contract";

/**
 * Shared module contract. Types only: see docs/architecture/CONTRACTS.md.
 * Owned by the Lead Architect. Change it only through a PR that every lane can see.
 *
 * Deliberately small: a static list of modules in code, no runtime loading, no lifecycle hooks.
 */

/** The four product areas. Motion Lab is the preview engine they share, not a studio. */
export type StudioId = "mapping" | "content" | "engineering" | "output";

/** Shown in the interface. A module with a requirement stays off until it's set up. */
export interface ModuleRequirements {
  readonly network?: boolean;
  readonly native?: boolean;
  readonly secrets?: boolean;
}

export interface PixelLabModule {
  readonly id: string;
  readonly name: string;
  readonly studio: StudioId;
  readonly requires?: ModuleRequirements;
  /** The module's workspace inside its studio, loaded on first use. */
  readonly panel?: () => Promise<{ default: ComponentType }>;
  /** Entries added to the Export menu. */
  readonly exports?: readonly ExportEntry[];
  /** Content the shared preview can play. */
  readonly sources?: readonly FrameSource[];
}
