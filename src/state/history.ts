import type { Project } from "@/domain/model";

/**
 * Undo history as immutable project snapshots. Every edit returns a new `Project` that shares
 * unchanged parts with the previous one, so a snapshot costs only what changed.
 *
 * Pure: no React, storage or clock. The caller passes the time.
 */
export interface History {
  /** Projects before each edit, oldest first. */
  readonly past: readonly Project[];
  /** Projects undone, the next redo last. */
  readonly future: readonly Project[];
  /** Key and time of the last recorded edit, for merging rapid repeats such as held arrow keys. */
  readonly lastKey: string | null;
  readonly lastAt: number;
}

export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 1000;

export const emptyHistory: History = { past: [], future: [], lastKey: null, lastAt: 0 };

export interface RecordOptions {
  /** Edits with the same key within `COALESCE_MS` of the previous one become a single undo step. */
  key?: string;
  now: number;
}

/** Records `before` as the state an undo returns to. A new edit always clears redo. */
export function record(history: History, before: Project, { key, now }: RecordOptions): History {
  const merges = key !== undefined && key === history.lastKey && now - history.lastAt <= COALESCE_MS && history.past.length > 0;
  const past = merges ? history.past : [...history.past, before].slice(-HISTORY_LIMIT);
  return { past, future: [], lastKey: key ?? null, lastAt: now };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** Steps back one edit. Returns null when there is nothing to undo. */
export function undo(history: History, current: Project): { history: History; project: Project } | null {
  const target = history.past.at(-1);
  if (!target) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, current], lastKey: null, lastAt: 0 },
    project: restore(target, current),
  };
}

/** Steps forward one undone edit. Returns null when there is nothing to redo. */
export function redo(history: History, current: Project): { history: History; project: Project } | null {
  const target = history.future.at(-1);
  if (!target) return null;
  return {
    history: { past: [...history.past, current], future: history.future.slice(0, -1), lastKey: null, lastAt: 0 },
    project: restore(target, current),
  };
}

/**
 * Returns the snapshot's content with the current save bookkeeping. Revision and save time
 * describe storage, not the edit: restoring an old revision would make the next save conflict.
 */
export function restore(snapshot: Project, current: Project): Project {
  return { ...snapshot, meta: { ...snapshot.meta, revision: current.meta.revision, updatedAt: current.meta.updatedAt } };
}
