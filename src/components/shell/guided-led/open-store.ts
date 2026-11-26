"use client";

import { create } from "zustand";

/**
 * Whether the guided LED flow is open, and whether it was opened to start a new project. Tiny and loaded with the
 * shell; the flow itself loads on first use. Workspace state: never saved, never undone.
 */
interface GuidedLedOpen {
  open: boolean;
  /** Opened from the start screen: the first file chosen creates a new, empty project. */
  fresh: boolean;
  show(fresh?: boolean): void;
  hide(): void;
}

export const useGuidedLedOpen = create<GuidedLedOpen>((set) => ({
  open: false,
  fresh: false,
  show: (fresh = false) => set({ open: true, fresh }),
  hide: () => set({ open: false, fresh: false }),
}));
