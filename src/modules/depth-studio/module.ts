import type { PixelLabModule } from "../contract";
import { depthSource } from "./source";

/** Depth Studio, in the Content Studio. Owned by Content Engineering from Sprint 3. */
export const depthStudioModule: PixelLabModule = {
  id: "depth-studio",
  name: "Depth Studio",
  studio: "content",
  panel: () => import("./studio-panel"),
  sources: [depthSource],
};
