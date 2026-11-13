import type { Project } from "@/domain/model";
import { removeModuleData, setModuleData } from "@/engines/project-ops";
import { useApp } from "@/state/store";

/**
 * Reading and writing a module's saved data. The project schema checks only the envelope
 * (`{ version, data }`), so every module brings a `parse` that checks its own data and upgrades older
 * versions. Anything it can't read comes back as `null`, and the module falls back to its defaults.
 */
export type ModuleDataParser<T> = (data: unknown, version: number) => T | null;

export function readModuleData<T>(project: Project, moduleId: string, parse: ModuleDataParser<T>): T | null {
  const entry = project.modules[moduleId];
  if (!entry) return null;
  try {
    return parse(entry.data, entry.version);
  } catch {
    return null;
  }
}

/**
 * Saves a module's data through the project store, so it autosaves and undoes like any other edit.
 * Pass `coalesce` for continuous input such as a slider, so one drag is one undo step.
 */
export function writeModuleData(moduleId: string, version: number, data: unknown, coalesce?: string): void {
  useApp.getState().edit((project) => setModuleData(project, moduleId, version, data), coalesce ? { coalesce } : undefined);
}

export function clearModuleData(moduleId: string): void {
  useApp.getState().edit((project) => removeModuleData(project, moduleId));
}
