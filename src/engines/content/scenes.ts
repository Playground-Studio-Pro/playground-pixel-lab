/**
 * Saved scenes and stage poses, stored in `modules["scenes"]`. Pure.
 *
 * A scene is a base source over the whole master plus per-screen overrides: one screen (a door, say)
 * plays another source inside its own master rectangle. A stage pose says how a movable screen sits
 * on the stage right now. Neither changes the mapping: the slices, output rectangles and every
 * mapping export stay the same whatever scene or pose is chosen.
 *
 * Source ids are the Live preview's: a Motion Lab pattern id, or `source:<id>` for a module source.
 */

export const SCENES_MODULE_ID = "scenes";
export const SCENES_VERSION = 1;

export type StagePose = "closed" | "open";

export interface SceneOverride {
  readonly screenId: string;
  readonly sourceId: string;
}

export interface Scene {
  readonly id: string;
  readonly name: string;
  readonly base: string;
  readonly overrides: readonly SceneOverride[];
}

export interface ScenesData {
  /** The scene the Live preview plays, or null for the preview's own source. */
  readonly active: string | null;
  readonly scenes: readonly Scene[];
  readonly stagePoses: Readonly<Record<string, StagePose>>;
}

export const EMPTY_SCENES: ScenesData = { active: null, scenes: [], stagePoses: {} };

const MAX_SCENES = 64;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 80;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => k in value);
}

function parseScene(raw: unknown): Scene | null {
  if (!isRecord(raw) || !exactKeys(raw, ["id", "name", "base", "overrides"])) return null;
  const { id, name, base, overrides } = raw;
  if (!isId(id) || typeof name !== "string" || name.length > 80 || !isId(base) || !Array.isArray(overrides)) return null;
  const parsed: SceneOverride[] = [];
  for (const o of overrides) {
    if (!isRecord(o) || !exactKeys(o, ["screenId", "sourceId"]) || !isId(o.screenId) || !isId(o.sourceId)) return null;
    if (parsed.some((p) => p.screenId === o.screenId)) return null;
    parsed.push({ screenId: o.screenId, sourceId: o.sourceId });
  }
  return { id, name, base, overrides: parsed };
}

/** Strict: anything unexpected gives null, and the project opens without scenes. */
export function parseScenes(data: unknown, version: number): ScenesData | null {
  if (version !== SCENES_VERSION || !isRecord(data) || !exactKeys(data, ["active", "scenes", "stagePoses"])) return null;
  const { active, scenes, stagePoses } = data;
  if (!Array.isArray(scenes) || scenes.length > MAX_SCENES || !isRecord(stagePoses)) return null;
  const parsed: Scene[] = [];
  for (const raw of scenes) {
    const scene = parseScene(raw);
    if (!scene || parsed.some((s) => s.id === scene.id)) return null;
    parsed.push(scene);
  }
  if (active !== null && !(isId(active) && parsed.some((s) => s.id === active))) return null;
  const poses: Record<string, StagePose> = {};
  for (const [screenId, pose] of Object.entries(stagePoses)) {
    if (!isId(screenId) || (pose !== "closed" && pose !== "open")) return null;
    poses[screenId] = pose;
  }
  return { active: active as string | null, scenes: parsed, stagePoses: poses };
}

export function activeScene(data: ScenesData): Scene | null {
  return data.scenes.find((s) => s.id === data.active) ?? null;
}

export function addScene(data: ScenesData, scene: Scene): ScenesData {
  if (data.scenes.some((s) => s.id === scene.id)) throw new Error(`A scene with id "${scene.id}" already exists.`);
  return { ...data, scenes: [...data.scenes, scene] };
}

export function removeScene(data: ScenesData, id: string): ScenesData {
  return { ...data, active: data.active === id ? null : data.active, scenes: data.scenes.filter((s) => s.id !== id) };
}

export function setActiveScene(data: ScenesData, id: string | null): ScenesData {
  if (id !== null && !data.scenes.some((s) => s.id === id)) throw new Error(`No scene "${id}".`);
  return { ...data, active: id };
}

/** Sets or, with null, clears what one screen plays in a scene. */
export function setOverride(data: ScenesData, sceneId: string, screenId: string, sourceId: string | null): ScenesData {
  return {
    ...data,
    scenes: data.scenes.map((s) => {
      if (s.id !== sceneId) return s;
      const rest = s.overrides.filter((o) => o.screenId !== screenId);
      return { ...s, overrides: sourceId === null ? rest : [...rest, { screenId, sourceId }] };
    }),
  };
}

/** Sets a screen's pose, or with null says the screen doesn't move. */
export function setStagePose(data: ScenesData, screenId: string, pose: StagePose | null): ScenesData {
  const poses = { ...data.stagePoses };
  if (pose === null) delete poses[screenId];
  else poses[screenId] = pose;
  return { ...data, stagePoses: poses };
}
