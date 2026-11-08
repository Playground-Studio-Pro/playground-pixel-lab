"use client";

import { create } from "zustand";
import type { ContentFps, PatternId, PlaybackSpeed } from "@/domain/motion";
import * as clock from "@/engines/motion/clock";

export type CanvasMode = "mapping" | "live";

/**
 * Motion Lab playback state. Kept apart from the project store on purpose: nothing here is saved,
 * undone or exported, and switching modes can't change the mapping.
 *
 * The current frame isn't stored here. It's derived from the clock on each animation frame, so
 * playback causes no React updates.
 */
interface MotionState {
  mode: CanvasMode;
  pattern: PatternId;
  fps: ContentFps;
  speed: PlaybackSpeed;
  clock: clock.PlaybackClock;
  showGuides: boolean;
  showOverlaps: boolean;
  /** Bumped to reset the measured statistics. */
  statsEpoch: number;
  /** Set when the preview opens: playback starts once it can draw, so no frames pass unseen while it loads. */
  autoplayPending: boolean;

  setMode(mode: CanvasMode): void;
  /** Called by the preview when it's ready to draw. */
  startPendingPlayback(): void;
  togglePlay(): void;
  restart(): void;
  setPattern(pattern: PatternId): void;
  setFps(fps: ContentFps): void;
  setSpeed(speed: PlaybackSpeed): void;
  setShowGuides(show: boolean): void;
  setShowOverlaps(show: boolean): void;
}

const now = () => performance.now();

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export const useMotion = create<MotionState>((set, get) => ({
  mode: "mapping",
  pattern: "flow",
  fps: 30,
  speed: 1,
  clock: clock.initialClock,
  showGuides: true,
  showOverlaps: true,
  statsEpoch: 0,
  autoplayPending: false,

  setMode(mode) {
    const state = get();
    if (mode === state.mode) return;
    // Opening the preview starts playback, as a response to the click. Reduced motion leaves it paused.
    set({ mode, clock: clock.pause(state.clock, now()), autoplayPending: mode === "live" && !prefersReducedMotion() });
  },
  startPendingPlayback() {
    const state = get();
    if (!state.autoplayPending) return;
    set({ autoplayPending: false, clock: clock.play(state.clock, now()), statsEpoch: state.statsEpoch + 1 });
  },
  togglePlay() {
    const { clock: c, statsEpoch } = get();
    set({ clock: c.playing ? clock.pause(c, now()) : clock.play(c, now()), statsEpoch: statsEpoch + 1 });
  },
  restart() {
    set((s) => ({ clock: clock.restart(s.clock, now()), statsEpoch: s.statsEpoch + 1 }));
  },
  setPattern(pattern) {
    set({ pattern });
  },
  setFps(fps) {
    // Keep the same moment in the content: the frame number changes, the content time doesn't.
    set((s) => ({ fps, statsEpoch: s.statsEpoch + 1 }));
  },
  setSpeed(speed) {
    set((s) => ({ speed, clock: clock.setSpeed(s.clock, speed, now()), statsEpoch: s.statsEpoch + 1 }));
  },
  setShowGuides(showGuides) {
    set({ showGuides });
  },
  setShowOverlaps(showOverlaps) {
    set({ showOverlaps });
  },
}));
