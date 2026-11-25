import type { StoreApi } from "zustand";
import { changedPaths, CONTENT_DATA_VERSION, parseSavedContent, type SavedContent } from "@/engines/content/looks";
import { readModuleData, writeModuleData } from "@/modules/module-data";
import { useApp } from "@/state/store";

/**
 * Keeps a content module's store and the open project in step, through the project's `modules[id]`.
 *
 * - Opening a project, importing, undo and redo load the project's data into the store, or the module's
 *   defaults. Loading never edits the project, so an older project opens unchanged and stays saved.
 * - A change in the store is written as a normal edit: autosaved and undoable. Changes to one value in quick
 *   succession, such as a drag, are one undo step.
 *
 * Only editor code may import this. The stores themselves don't, so the output page can use them without the
 * project store.
 */
export function bindSavedContent<State, S>(options: {
  moduleId: string;
  store: StoreApi<State>;
  defaults: S;
  normalize(input: unknown): S;
  read(state: State): SavedContent<S>;
  load(saved: SavedContent<S>): void;
}): () => void {
  const { moduleId, store, defaults, normalize, read, load } = options;
  let busy = false;

  const loadProject = () => {
    const { project } = useApp.getState();
    const saved = project && readModuleData(project, moduleId, (data, version) => parseSavedContent(data, version, normalize));
    busy = true;
    try {
      load(saved ?? { settings: defaults, looks: [] });
    } finally {
      busy = false;
    }
  };

  const stopProject = useApp.subscribe((state, previous) => {
    if (busy || state.project === previous.project) return;
    if (state.project?.id !== previous.project?.id || state.project?.modules[moduleId] !== previous.project?.modules[moduleId]) loadProject();
  });

  const stopStore = store.subscribe((state, previous) => {
    if (busy || !useApp.getState().project) return;
    const [next, before] = [read(state), read(previous)];
    if (next.settings === before.settings && next.looks === before.looks) return;
    const changes = changedPaths(before, next);
    if (changes.length === 0) return;
    busy = true;
    try {
      writeModuleData(moduleId, CONTENT_DATA_VERSION, next, changes.length === 1 && changes[0].startsWith("settings.") ? `${moduleId}:${changes[0]}` : undefined);
    } finally {
      busy = false;
    }
  });

  loadProject();
  return () => {
    stopProject();
    stopStore();
  };
}
