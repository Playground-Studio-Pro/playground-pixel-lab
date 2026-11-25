"use client";

import { create } from "zustand";
import { applyWallBuild, DEFAULT_WALL_BUILD, type WallBuildSettings } from "@/engines/content/wall-build/settings";

/** Wall Build settings. Module state: never saved, undone or exported, and it can't change the mapping. */
interface WallBuildState {
  settings: WallBuildSettings;
  update(change: Partial<WallBuildSettings>): void;
}

export const useWallBuild = create<WallBuildState>((set) => ({
  settings: DEFAULT_WALL_BUILD,
  update(change) {
    set((s) => ({ settings: applyWallBuild(s.settings, change) }));
  },
}));
