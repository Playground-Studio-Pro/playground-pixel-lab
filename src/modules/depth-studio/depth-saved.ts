import { EMERALD_CHAMBER, normalizeDepthConfig } from "@/engines/depth/config";
import { bindSavedContent } from "@/modules/content/saved-content";
import { useDepth } from "./depth-store";

/** Depth Studio's scene and looks, in the project. What it's framed for stays with the editor. */
bindSavedContent({
  moduleId: "depth-studio",
  store: useDepth,
  defaults: EMERALD_CHAMBER,
  normalize: normalizeDepthConfig,
  read: (s) => ({ settings: s.config, looks: s.looks }),
  load: ({ settings, looks }) => useDepth.getState().load(settings, looks),
});
