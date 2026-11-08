/**
 * Motion Lab settings. Playback state only: nothing here is stored in a project.
 *
 * Three rates stay separate and are never derived from each other:
 * - content FPS: the rate the test content is designed to play at (`ContentFps`);
 * - browser preview FPS: how fast this browser is drawing, measured at runtime;
 * - LED refresh rate: a property of the physical panel, which Motion Lab doesn't measure.
 */

export const CONTENT_FPS = [24, 25, 30, 50, 60] as const;
export type ContentFps = (typeof CONTENT_FPS)[number];

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export type PatternId = "flow" | "aurora" | "grid" | "scan-h" | "scan-v" | "rgb" | "counter";

export interface PatternInfo {
  readonly id: PatternId;
  readonly name: string;
  /** What the pattern helps check on a real wall. */
  readonly checks: string;
}

export const PATTERNS: readonly PatternInfo[] = [
  { id: "flow", name: "Content Flow", checks: "Continuity of moving content across every screen boundary" },
  { id: "aurora", name: "Aurora Gradient", checks: "Smooth color flow and uniformity across every screen boundary" },
  { id: "grid", name: "Moving Grid", checks: "Alignment and spacing: lines must stay straight across screens" },
  { id: "scan-h", name: "Horizontal Scan", checks: "Column order and screen order from left to right" },
  { id: "scan-v", name: "Vertical Scan", checks: "Row order and vertical alignment between screens" },
  { id: "rgb", name: "RGB Color Cycle", checks: "Color channels and uniformity across all screens" },
  { id: "counter", name: "Frame Counter", checks: "Every screen showing the same frame at the same time" },
];

/** A screen as Motion Lab draws it: its mapped region on the master canvas. */
export interface MotionScreen {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
