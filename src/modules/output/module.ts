import type { PixelLabModule } from "../contract";
import { calibrationSource } from "./calibration-source";

/**
 * The Output Studio module. Owned by Output Engineering. The panel exports MP4 through `video-export.ts`. The test
 * card is Product Design's calibration frame, played through `calibration-source.ts`. The source id must stay `calibration-test-card`, which `catalog.ts`
 * lists for the Live preview menu.
 */
export const outputModule: PixelLabModule = {
  id: "output",
  name: "Output",
  studio: "output",
  panel: () => import("./studio-panel"),
  sources: [calibrationSource],
};
