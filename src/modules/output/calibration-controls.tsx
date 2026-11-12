"use client";

import { SelectField } from "@/components/workspace/fields";
import type { CalibrationMode, LogoMode } from "@/components/shell/calibration/frame";
import { useCalibrationSource } from "./calibration-store";

const MODES: readonly { value: CalibrationMode; label: string }[] = [
  { value: "identification", label: "Identification" },
  { value: "calibration", label: "Calibration" },
];
const LOGO_MODES: readonly { value: LogoMode; label: string }[] = [
  { value: "center", label: "Logo center" },
  { value: "watermark", label: "Logo watermark" },
  { value: "off", label: "Logo off" },
];

/** Live preview header controls for the calibration test card. Compact selects, so the header still fits. */
export function CalibrationSourceControls() {
  const mode = useCalibrationSource((s) => s.mode);
  const logo = useCalibrationSource((s) => s.logoByMode[s.mode]);
  const state = useCalibrationSource.getState();
  return (
    <>
      <SelectField ariaLabel="Test card frame" className="w-32" value={mode} items={MODES} onChange={(v) => state.setMode(v as CalibrationMode)} />
      <SelectField ariaLabel="Logo" className="w-36" value={logo} items={LOGO_MODES} onChange={(v) => state.setLogo(v as LogoMode)} />
    </>
  );
}
