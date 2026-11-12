import type { PixelLabModule } from "../contract";

/**
 * The Engineering Studio module. Owned by LED Engineering: add the panel, and any exports, here.
 * Until a panel exists the studio shows its empty state.
 */
export const engineeringModule: PixelLabModule = {
  id: "engineering",
  name: "LED engineering",
  studio: "engineering",
};
