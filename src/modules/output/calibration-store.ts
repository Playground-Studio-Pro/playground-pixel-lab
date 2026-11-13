import { create } from "zustand";
import type { CalibrationMode, LogoMode } from "@/components/shell/calibration/frame";

/**
 * How the calibration test card plays in Live preview: which frame and where the logo goes.
 * Interface state, not saved with the project. Kept free of the frame code so the canvas header can
 * read it without loading the test card.
 */
export interface CalibrationSourceState {
  readonly mode: CalibrationMode;
  /** Each mode keeps its own logo setting: a centered logo would cover the calibration crosshair. */
  readonly logoByMode: Readonly<Record<CalibrationMode, LogoMode>>;
  setMode(mode: CalibrationMode): void;
  setLogo(logo: LogoMode): void;
}

export const useCalibrationSource = create<CalibrationSourceState>((set) => ({
  mode: "identification",
  logoByMode: { identification: "center", calibration: "off" },
  setMode: (mode) => set({ mode }),
  setLogo: (logo) => set((s) => ({ logoByMode: { ...s.logoByMode, [s.mode]: logo } })),
}));
