import type { ContentFps, MotionScreen } from "@/domain/motion";

/**
 * Shared rendering contract for the Motion Lab preview engine. Types only: see docs/architecture/CONTRACTS.md.
 * Owned by the Lead Architect. Change it only through a PR that every lane can see.
 */

/** What a source gets for one content frame. Sizes and screens are in master pixels. */
export interface FrameInput {
  readonly frame: number;
  readonly fps: ContentFps;
  /** Master canvas size. */
  readonly width: number;
  readonly height: number;
  /** Each screen's region on the master canvas, from `resolveMapping`. */
  readonly screens: readonly MotionScreen[];
}

export interface DrawOptions {
  /** Device pixels per master pixel. 1 for exports, full-screen output and video. */
  readonly scale: number;
  readonly fontFamily: string;
}

/**
 * Anything the shared preview, full-screen output or a video export can play: Motion Lab patterns today,
 * content layouts and generated media later.
 *
 * Rules:
 * - It draws the whole master canvas once. The engine cuts it into screens and outputs through the mapping.
 * - The same frame and input always draw the same pixels: no clock, no randomness, no network inside `draw`.
 * - Media a source needs (images, decoded video) is loaded before playback, not during `draw`.
 */
export interface FrameSource {
  readonly id: string;
  readonly name: string;
  draw(ctx: CanvasRenderingContext2D, input: FrameInput, options: DrawOptions): void;
}
