/**
 * A content module's saved data: its current settings, and named looks to return to. Pure.
 *
 * It's read from projects and files, so reading is strict about shape and generous about values: each
 * module's `normalize` brings settings into range, a look that can't be read is dropped, and data from a
 * newer version isn't read at all.
 */

export interface Look<S> {
  readonly id: string;
  readonly name: string;
  readonly settings: S;
}

export interface SavedContent<S> {
  readonly settings: S;
  readonly looks: readonly Look<S>[];
}

export const CONTENT_DATA_VERSION = 1;
export const MAX_LOOKS = 50;
export const MAX_LOOK_NAME = 40;

/** Says what's wrong, for the field to show. */
export class LookError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const tidyName = (name: string) => name.trim().replace(/\s+/g, " ");

function checkName(looks: readonly Look<unknown>[], name: string, exceptId?: string): string {
  const tidy = tidyName(name);
  if (!tidy) throw new LookError("Type a name for the look.");
  if (tidy.length > MAX_LOOK_NAME) throw new LookError(`Use ${MAX_LOOK_NAME} characters or fewer.`);
  const taken = looks.find((l) => l.id !== exceptId && l.name.toLowerCase() === tidy.toLowerCase());
  if (taken) throw new LookError(`There's already a look called ${taken.name}.`);
  return tidy;
}

export function addLook<S>(looks: readonly Look<S>[], id: string, name: string, settings: S): readonly Look<S>[] {
  if (looks.length >= MAX_LOOKS) throw new LookError(`A project keeps up to ${MAX_LOOKS} looks here. Delete one first.`);
  return [...looks, { id, name: checkName(looks, name), settings }];
}

export function renameLook<S>(looks: readonly Look<S>[], id: string, name: string): readonly Look<S>[] {
  const current = looks.find((l) => l.id === id);
  if (!current) return looks;
  const tidy = checkName(looks, name, id);
  return tidy === current.name ? looks : looks.map((l) => (l.id === id ? { ...l, name: tidy } : l));
}

export function removeLook<S>(looks: readonly Look<S>[], id: string): readonly Look<S>[] {
  return looks.some((l) => l.id === id) ? looks.filter((l) => l.id !== id) : looks;
}

/** The first free "Look N". */
export function nextLookName(looks: readonly Look<unknown>[]): string {
  const taken = new Set(looks.map((l) => l.name.toLowerCase()));
  let n = 1;
  while (taken.has(`look ${n}`)) n++;
  return `Look ${n}`;
}

export function sameSettings(a: unknown, b: unknown): boolean {
  return changedPaths(a, b).length === 0;
}

/** The look whose settings are the current ones, if any. */
export function activeLook<S>({ settings, looks }: SavedContent<S>): string | null {
  return looks.find((l) => sameSettings(l.settings, settings))?.id ?? null;
}

/** Null when the data isn't this module's shape or version: the module then uses its defaults. */
export function parseSavedContent<S>(data: unknown, version: number, normalize: (input: unknown) => S): SavedContent<S> | null {
  if (version !== CONTENT_DATA_VERSION || !isRecord(data) || !isRecord(data.settings)) return null;
  let looks: readonly Look<S>[] = [];
  const ids = new Set<string>();
  for (const entry of Array.isArray(data.looks) ? data.looks : []) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || typeof entry.name !== "string" || !isRecord(entry.settings)) continue;
    try {
      looks = addLook(looks, entry.id, entry.name, normalize(entry.settings));
      ids.add(entry.id);
    } catch (error) {
      if (!(error instanceof LookError)) throw error;
    }
  }
  return { settings: normalize(data.settings), looks };
}

/** Paths of every plain value that differs, such as `room.depthM`. */
export function changedPaths(a: unknown, b: unknown, path = ""): string[] {
  if (Object.is(a, b)) return [];
  const both = typeof a === "object" && typeof b === "object" && a !== null && b !== null && Array.isArray(a) === Array.isArray(b);
  if (!both) return [path];
  const [x, y] = [a as Record<string, unknown>, b as Record<string, unknown>];
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((key) => changedPaths(x[key], y[key], path ? `${path}.${key}` : key));
}
