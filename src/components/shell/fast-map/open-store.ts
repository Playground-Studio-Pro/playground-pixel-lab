"use client";

import { create } from "zustand";

/**
 * Whether Fast map is open. Tiny and loaded with the shell, so the start screen and the explorer can open it; the
 * Fast map view itself loads on first use. Workspace state: never saved, never undone.
 */
interface FastMapOpen {
  open: boolean;
  show(): void;
  hide(): void;
}

export const useFastMapOpen = create<FastMapOpen>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
