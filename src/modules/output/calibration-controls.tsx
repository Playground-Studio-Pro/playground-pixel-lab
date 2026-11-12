"use client";

import { Segmented } from "@/components/shell/calibration/controls";
import type { CalibrationMode, LogoMode } from "@/components/shell/calibration/frame";
import { useCalibrationSource } from "./calibration-store";

const MODES: readonly { value: CalibrationMode; label: string }[] = [
  { value: "identification", label: "Identification" },
  { value: "calibration", label: "Calibration" },
];
const LOGO_MODES: readonly { value: LogoMode; label: string }[] = [
  { value: "center", label: "Logo center" },
  { value: "watermark", label: "Watermark" },
  { value: "off", label: "Off" },
];

/** Live preview header controls for the calibration test card. */
export function CalibrationSourceControls() {
  const mode = useCalibrationSource((s) => s.mode);
  const logo = useCalibrationSource((s) => s.logoByMode[s.mode]);
  const state = useCalibrationSource.getState();
  return (
    <>
      <Segmented label="Test card frame" value={mode} options={MODES} onChange={state.setMode} />
      <Segmented label="Logo" value={logo} options={LOGO_MODES} onChange={state.setLogo} />
    </>
  );
}
