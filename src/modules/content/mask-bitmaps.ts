"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { bitmapFromRgba, type MaskBitmap } from "@/engines/content/mask";

/**
 * PNG masks, kept in this browser's IndexedDB and never in the project: an event mask can be large and
 * belongs to the machine that prepared it. The project only records that the canvas has a mask switched
 * on. On another machine the PNG is missing and the preview says so.
 */

const DB_NAME = "playground-pixel-lab-masks";
const STORE = "png";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function decode(blob: Blob): Promise<MaskBitmap> {
  const image = await createImageBitmap(blob);
  try {
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    return bitmapFromRgba(ctx.getImageData(0, 0, image.width, image.height).data, image.width, image.height);
  } finally {
    image.close();
  }
}

const key = (projectId: string, canvasId: string) => `${projectId}/${canvasId}`;

interface MaskBitmapState {
  projectId: string | null;
  /** Decoded PNG masks for the open project, by canvas id. */
  bitmaps: Record<string, MaskBitmap>;
  load(projectId: string, canvasIds: readonly string[]): Promise<void>;
  importPng(projectId: string, canvasId: string, file: Blob): Promise<void>;
  remove(projectId: string, canvasId: string): Promise<void>;
}

export const useMaskBitmaps = create<MaskBitmapState>((set, get) => ({
  projectId: null,
  bitmaps: {},
  async load(projectId, canvasIds) {
    const bitmaps: Record<string, MaskBitmap> = {};
    for (const id of canvasIds) {
      const blob = await tx<Blob | undefined>("readonly", (s) => s.get(key(projectId, id))).catch(() => undefined);
      if (blob) bitmaps[id] = await decode(blob);
    }
    set({ projectId, bitmaps });
  },
  async importPng(projectId, canvasId, file) {
    if (file.type && file.type !== "image/png") throw new Error("Use a PNG for an image mask: white shows, black or transparent hides.");
    const bitmap = await decode(file);
    await tx("readwrite", (s) => s.put(file, key(projectId, canvasId)));
    if (get().projectId === projectId) set({ bitmaps: { ...get().bitmaps, [canvasId]: bitmap } });
  },
  async remove(projectId, canvasId) {
    await tx("readwrite", (s) => s.delete(key(projectId, canvasId)));
    const bitmaps = { ...get().bitmaps };
    delete bitmaps[canvasId];
    set({ bitmaps });
  },
}));

const NO_BITMAPS: Record<string, MaskBitmap> = {};

/** Loads the open project's PNG masks once per project, and returns them. */
export function useProjectMaskBitmaps(projectId: string | undefined, canvasIds: readonly string[]): Record<string, MaskBitmap> {
  const bitmaps = useMaskBitmaps((s) => s.bitmaps);
  const loadedFor = useMaskBitmaps((s) => s.projectId);
  const ids = canvasIds.join("\n");
  useEffect(() => {
    if (!projectId || loadedFor === projectId || typeof indexedDB === "undefined") return;
    void useMaskBitmaps.getState().load(projectId, ids.split("\n").filter(Boolean)).catch(() => undefined);
  }, [projectId, loadedFor, ids]);
  return loadedFor === projectId ? bitmaps : NO_BITMAPS;
}
