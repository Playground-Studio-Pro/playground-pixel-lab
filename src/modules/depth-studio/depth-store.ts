"use client";

import { create } from "zustand";
import { DEPTH_PRESETS, loopFrameCount, normalizeDepthConfig, type DepthSceneConfig } from "@/engines/depth/config";
import * as clock from "@/engines/motion/clock";

/**
 * Depth Studio state. Module state: never saved, undone or exported, and it can't change the mapping.
 * Saving a scene waits for the `modules[id]` project section (task L2), like Aurora's settings.
 *
 * The current frame isn't stored. It's derived from the clock on each animation frame, so playback
 * causes no React updates.
 */
type DeepPartial<T> = { readonly [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

interface DepthState {
  config: DepthSceneConfig;
  presetId: string;
  /** Which canvas or screen the scene is framed for. Null follows the first available target. */
  targetId: string | null;
  clock: clock.PlaybackClock;
  showGuides: boolean;
  /** Bumped to reset the measured statistics. */
  statsEpoch: number;

  /** Merges a change into the config. The result is always clamped to valid ranges. */
  patch(change: DeepPartial<DepthSceneConfig>): void;
  applyPreset(id: string): void;
  setTarget(id: string): void;
  setShowGuides(show: boolean): void;
  togglePlay(): void;
  play(): void;
  restart(): void;
  /** Moves to a frame of the loop, keeping play or pause. */
  seek(frame: number): void;
}

const now = () => performance.now();

function merge<T>(base: T, change: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(change)) {
    const current = out[key];
    out[key] = typeof value === "object" && value !== null && typeof current === "object" && current !== null ? merge(current, value) : value;
  }
  return out as T;
}

/** The frame of the loop showing at a time. */
export function depthFrameAt(state: Pick<DepthState, "clock" | "config">, nowMs: number): number {
  return clock.frameAt(clock.contentTime(state.clock, nowMs), state.config.fps) % loopFrameCount(state.config);
}

export const useDepth = create<DepthState>((set, get) => ({
  config: DEPTH_PRESETS[0].config,
  presetId: DEPTH_PRESETS[0].id,
  targetId: null,
  clock: clock.initialClock,
  showGuides: false,
  statsEpoch: 0,

  patch(change) {
    const state = get();
    const frame = depthFrameAt(state, now());
    const config = normalizeDepthConfig(merge(state.config, change));
    // Changing the rate or the length keeps the same frame where it still exists.
    const timing = config.fps !== state.config.fps || config.durationSeconds !== state.config.durationSeconds;
    set({
      config,
      ...(timing ? { clock: { ...state.clock, baseMs: clock.frameStartMs(frame % loopFrameCount(config), config.fps), anchorMs: now() }, statsEpoch: state.statsEpoch + 1 } : {}),
    });
  },
  applyPreset(id) {
    const preset = DEPTH_PRESETS.find((p) => p.id === id);
    if (preset) set((s) => ({ config: preset.config, presetId: id, clock: clock.restart(s.clock, now()), statsEpoch: s.statsEpoch + 1 }));
  },
  setTarget(targetId) {
    set({ targetId });
  },
  setShowGuides(showGuides) {
    set({ showGuides });
  },
  togglePlay() {
    const { clock: c, statsEpoch } = get();
    set({ clock: c.playing ? clock.pause(c, now()) : clock.play(c, now()), statsEpoch: statsEpoch + 1 });
  },
  play() {
    set((s) => ({ clock: clock.play(s.clock, now()), statsEpoch: s.statsEpoch + 1 }));
  },
  restart() {
    set((s) => ({ clock: clock.restart(s.clock, now()), statsEpoch: s.statsEpoch + 1 }));
  },
  seek(frame) {
    set((s) => ({ clock: { ...s.clock, baseMs: clock.frameStartMs(frame, s.config.fps), anchorMs: now() } }));
  },
}));
