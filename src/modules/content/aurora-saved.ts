import { DEFAULT_AURORA, normalizeAurora } from "@/engines/content/aurora";
import { useAurora } from "./aurora-store";
import { bindSavedContent } from "./saved-content";

/** Aurora's settings and looks, in the project. */
bindSavedContent({
  moduleId: "aurora",
  store: useAurora,
  defaults: DEFAULT_AURORA,
  normalize: normalizeAurora,
  read: (s) => ({ settings: s.settings, looks: s.looks }),
  load: (saved) => useAurora.setState(saved),
});
