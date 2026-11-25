"use client";

import { create } from "zustand";
import { addLook, removeLook, renameLook, type Look } from "@/engines/content/looks";
import { DEPTH_PRESETS, loopFrameCount, normalizeDepthConfig, type DepthSceneConfig } from "@/engines/depth/config";
import * as clock from "@/engines/motion/clock";

/**
 * Depth Studio state. It can't change the mapping. `depth-saved.ts` keeps the scene and its looks in step
 * with the open project, where they're saved and undone; the rest is editor state. This file imports nothing
 * from the project store, because the output page uses it.
 *
 * The current frame isn't stored. It's derived from the clock on each animation frame, so playback
 * causes no React updates.
 */
type DeepPartial<T> = { readonly [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

interface DepthState {
  config: DepthSceneConfig;
  looks: readonly Look<DepthSceneConfig>[];
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
  /** The scene and looks of the open project. */
  load(config: DepthSceneConfig, looks: readonly Look<DepthSceneConfig>[]): void;
  /** These throw a `LookError` with the reason when a name can't be used. */
  saveLook(name: string): void;
  renameLook(id: string, name: string): void;
  applyLook(id: string): void;
  removeLook(id: string): void;
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

/** A new config. Changing the rate or the length keeps the same frame where it still exists. */
function withConfig(state: DepthState, config: DepthSceneConfig): Partial<DepthState> {
  if (config.fps === state.config.fps && config.durationSeconds === state.config.durationSeconds) return { config };
  const frame = depthFrameAt(state, now());
  return { config, clock: { ...state.clock, baseMs: clock.frameStartMs(frame % loopFrameCount(config), config.fps), anchorMs: now() }, statsEpoch: state.statsEpoch + 1 };
}

export const useDepth = create<DepthState>((set, get) => ({
  config: DEPTH_PRESETS[0].config,
  looks: [],
  presetId: DEPTH_PRESETS[0].id,
  targetId: null,
  clock: clock.initialClock,
  showGuides: false,
  statsEpoch: 0,

  patch(change) {
    set((s) => withConfig(s, normalizeDepthConfig(merge(s.config, change))));
  },
  load(config, looks) {
    set((s) => ({ ...withConfig(s, config), looks }));
  },
  saveLook(name) {
    set((s) => ({ looks: addLook(s.looks, crypto.randomUUID(), name, s.config) }));
  },
  renameLook(id, name) {
    set((s) => ({ looks: renameLook(s.looks, id, name) }));
  },
  applyLook(id) {
    set((s) => {
      const look = s.looks.find((l) => l.id === id);
      return look ? withConfig(s, look.settings) : s;
    });
  },
  removeLook(id) {
    set((s) => ({ looks: removeLook(s.looks, id) }));
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
