"use client";

import { create } from "zustand";
import { addLook, removeLook, renameLook, type Look } from "@/engines/content/looks";
import { DEFAULT_AURORA, type AuroraDirection, type AuroraSettings, type AuroraSpeed } from "@/engines/content/aurora";

/**
 * Aurora Gradient settings and looks. They can't change the mapping. `aurora-saved.ts` keeps them in step
 * with the open project, where they're saved and undone.
 */
interface AuroraState {
  settings: AuroraSettings;
  looks: readonly Look<AuroraSettings>[];
  setColors(colors: readonly string[]): void;
  setColor(index: number, color: string): void;
  setSpeed(speed: AuroraSpeed): void;
  setDirection(direction: AuroraDirection): void;
  /** These throw a `LookError` with the reason when a name can't be used. */
  saveLook(name: string): void;
  renameLook(id: string, name: string): void;
  applyLook(id: string): void;
  removeLook(id: string): void;
}

export const useAurora = create<AuroraState>((set) => ({
  settings: DEFAULT_AURORA,
  looks: [],
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
  saveLook(name) {
    set((s) => ({ looks: addLook(s.looks, crypto.randomUUID(), name, s.settings) }));
  },
  renameLook(id, name) {
    set((s) => ({ looks: renameLook(s.looks, id, name) }));
  },
  applyLook(id) {
    set((s) => ({ settings: s.looks.find((l) => l.id === id)?.settings ?? s.settings }));
  },
  removeLook(id) {
    set((s) => ({ looks: removeLook(s.looks, id) }));
  },
}));
