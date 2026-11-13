import type { PixelLabModule } from "../contract";
import { calibrationSource } from "./calibration-source";

/**
 * The Output Studio module. Owned by Output Engineering: add the panel and export entries here. The test
 * card is Product Design's calibration frame, played through `calibration-source.ts`. The source id must stay `calibration-test-card`, which `catalog.ts`
 * lists for the Live preview menu.
 */
export const outputModule: PixelLabModule = {
  id: "output",
  name: "Output",
  studio: "output",
  sources: [calibrationSource],
};
