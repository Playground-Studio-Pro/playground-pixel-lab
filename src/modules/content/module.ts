import type { PixelLabModule } from "../contract";
import { wallBuildSource } from "./wall-build-source";

/** Content modules of the Live preview. Owned by Content Engineering. */
export const contentModule: PixelLabModule = {
  id: "content",
  name: "Content",
  studio: "content",
  sources: [wallBuildSource],
};
