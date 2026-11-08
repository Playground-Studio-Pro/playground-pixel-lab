"use client";

import { create } from "zustand";
import { DEFAULT_AURORA, type AuroraDirection, type AuroraSettings, type AuroraSpeed } from "@/engines/content/aurora";

/**
 * Aurora Gradient settings. Module state: never saved, undone or exported, and it can't change the
 * mapping. Saving it waits for the `modules[id]` project section (task L2).
 */
interface AuroraState {
  settings: AuroraSettings;
  setColors(colors: readonly string[]): void;
  setColor(index: number, color: string): void;
  setSpeed(speed: AuroraSpeed): void;
  setDirection(direction: AuroraDirection): void;
}

export const useAurora = create<AuroraState>((set) => ({
  settings: DEFAULT_AURORA,
  setColors(colors) {
    set((s) => ({ settings: { ...s.settings, colors: [...colors] } }));
  },
  setColor(index, color) {
    set((s) => ({ settings: { ...s.settings, colors: s.settings.colors.map((c, i) => (i === index ? color.toUpperCase() : c)) } }));
  },
  setSpeed(speed) {
    set((s) => ({ settings: { ...s.settings, speed } }));
  },
  setDirection(direction) {
    set((s) => ({ settings: { ...s.settings, direction } }));
  },
}));
