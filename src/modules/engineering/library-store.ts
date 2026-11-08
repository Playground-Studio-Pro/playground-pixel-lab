"use client";

import { create } from "zustand";
import { EMPTY_LIBRARY_FIELDS, type LibraryCabinet } from "@/domain/cabinets";
import type { CabinetProfile, Id } from "@/domain/model";
import { openCabinetLibrary, type CabinetLibraryRepository } from "@/persistence/cabinet-library";

export interface CabinetLibraryState {
  status: "idle" | "loading" | "ready" | "failed";
  error: string | null;
  /** Sorted by name, as the repository returns them. */
  entries: readonly LibraryCabinet[];
  /** Opens the library. Safe to call many times. */
  init(): Promise<void>;
  save(entry: LibraryCabinet): Promise<void>;
  remove(id: Id): Promise<void>;
  /**
   * Keeps the library in step with a custom profile edited inside a project, as the
   * app did before the library existed. Supplier fields and specs already in the library are kept.
   */
  saveFromProject(profile: CabinetProfile): Promise<void>;
}

/** The library's own store: not part of a project, never undone, never exported. */
export function createCabinetLibraryStore(open: () => Promise<CabinetLibraryRepository>) {
  let repo: Promise<CabinetLibraryRepository> | null = null;

  return create<CabinetLibraryState>((set, get) => {
    const ready = () => {
      repo ??= open();
      return repo;
    };
    const refresh = async () => set({ entries: await (await ready()).list(), status: "ready", error: null });

    return {
      status: "idle",
      error: null,
      entries: [],

      async init() {
        if (get().status !== "idle") return;
        set({ status: "loading" });
        try {
          await refresh();
        } catch (error) {
          repo = null;
          set({ status: "failed", error: error instanceof Error ? error.message : String(error) });
        }
      },

      async save(entry) {
        await (await ready()).save(entry);
        await refresh();
      },

      async remove(id) {
        await (await ready()).delete(id);
        await refresh();
      },

      async saveFromProject(profile) {
        if (profile.source !== "custom") return;
        const library = await ready();
        const existing = await library.get(profile.id);
        await library.save({ ...EMPTY_LIBRARY_FIELDS, ...existing, ...profile, source: "custom" });
        await refresh();
      },
    };
  });
}

export const useCabinetLibrary = createCabinetLibraryStore(() => openCabinetLibrary());
