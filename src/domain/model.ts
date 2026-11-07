import type { PixelSpace, Px, Um } from "./units";

export type Id = string;

export const SCHEMA_VERSION = 1 as const;

/** A reusable LED cabinet definition. Copied into a project when used, so editing the library never alters a saved show. */
export interface CabinetProfile {
  readonly id: Id;
  readonly name: string;
  readonly widthUm: Um;
  readonly heightUm: Um;
  readonly pixelsX: Px;
  readonly pixelsY: Px;
  /** Manufacturer-stated pitch. Reference only: it is never used to derive resolution. */
  readonly nominalPitchUm: Um;
  readonly source: "builtin" | "custom";
}

export interface ScreenGroup {
  readonly id: Id;
  readonly name: string;
}

export interface LedScreen {
  readonly id: Id;
  readonly name: string;
  readonly cabinetId: Id;
  readonly columns: number;
  readonly rows: number;
  readonly groupId: Id | null;
  /** Identification colour used in pixel maps. */
  readonly color: string;
  /** Top-left position on the stage plan. */
  readonly stageX: Um;
  readonly stageY: Um;
}

/** PHYSICAL LAYOUT: what exists on stage, measured in micrometres. */
export interface PhysicalLayout {
  readonly screens: readonly LedScreen[];
  readonly groups: readonly ScreenGroup[];
}

export type CanvasSizing =
  | { readonly mode: "auto" }
  | { readonly mode: "fixed"; readonly width: Px; readonly height: Px };

/**
 * A named area of the master canvas. Several screens on one canvas form a
 * shared canvas (one continuous image); one screen on a canvas is independent.
 */
export interface ContentCanvas {
  readonly id: Id;
  readonly name: string;
  /** Canvas top-left, in master space. */
  readonly originX: Px;
  readonly originY: Px;
}

/** Where a screen takes its pixels from. Size is always the screen's resolution (1:1), so it cannot go out of sync. */
export interface ContentRegion {
  readonly screenId: Id;
  readonly canvasId: Id;
  /** Region top-left, in canvas space. */
  readonly x: Px;
  readonly y: Px;
  /** Marks overlap with another marked region as intentional: both screens show the same pixels. */
  readonly allowOverlap: boolean;
}

/** CONTENT LAYOUT: how screens read from the master canvas, in pixels. */
export interface ContentLayout {
  readonly master: CanvasSizing;
  readonly canvases: readonly ContentCanvas[];
  readonly regions: readonly ContentRegion[];
}

/** One video signal leaving the media server. */
export interface VideoOutput {
  readonly id: Id;
  readonly name: string;
  readonly sizing: CanvasSizing;
}

/** Where a screen's pixels are placed in a video output. */
export interface OutputSlice {
  readonly screenId: Id;
  readonly outputId: Id;
  /** When true the slice uses its master-canvas position and x/y are ignored. */
  readonly followsContent: boolean;
  /** Slice top-left, in output space. */
  readonly x: Px;
  readonly y: Px;
}

/** OUTPUT MAPPING: how pixels leave the media server toward the LED processors. */
export interface OutputMapping {
  readonly outputs: readonly VideoOutput[];
  readonly slices: readonly OutputSlice[];
}

export interface ProjectMeta {
  readonly name: string;
  readonly client: string;
  readonly venue: string;
  readonly notes: string;
  /** ISO 8601 timestamps. */
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Increments on every save. Used to detect conflicting writes, locally now and in cloud sync later. */
  readonly revision: number;
}

export interface Project {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly id: Id;
  readonly meta: ProjectMeta;
  readonly cabinets: readonly CabinetProfile[];
  readonly physical: PhysicalLayout;
  readonly content: ContentLayout;
  readonly output: OutputMapping;
}

export interface ProjectSummary {
  readonly id: Id;
  readonly name: string;
  readonly client: string;
  readonly venue: string;
  readonly updatedAt: string;
  readonly screenCount: number;
}

export type { PixelSpace };
