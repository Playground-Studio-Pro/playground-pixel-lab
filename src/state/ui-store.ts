"use client";

import { create } from "zustand";
import type { StudioId } from "@/modules/contract";

export type DialogName = "new-project" | "open-project" | "add-screen" | "new-cabinet" | "preview";

/** What was typed in Add screen, kept while New cabinet is open on top of it. */
export interface AddScreenDraft {
  name: string;
  columns: string;
  rows: string;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  action: string;
  onConfirm: () => void | Promise<void>;
}

interface UiState {
  /** The open studio. Workspace state: not saved, and switching never changes the project. */
  studio: StudioId;
  setStudio(studio: StudioId): void;
  dialog: DialogName | null;
  confirm: ConfirmRequest | null;
  /** Set while New cabinet was opened from Add screen: holds the cabinet to preselect on return. */
  addScreenCabinetId: string | null;
  returnToAddScreen: boolean;
  addScreenDraft: AddScreenDraft | null;
  openDialog(dialog: DialogName | null): void;
  startCabinetFromAddScreen(draft: AddScreenDraft): void;
  finishCabinet(cabinetId: string): void;
  askConfirm(request: ConfirmRequest | null): void;
}

export const useUi = create<UiState>((set) => ({
  studio: "mapping",
  setStudio: (studio) => set({ studio }),
  dialog: null,
  confirm: null,
  addScreenCabinetId: null,
  returnToAddScreen: false,
  addScreenDraft: null,
  openDialog: (dialog) => set({ dialog, returnToAddScreen: false, addScreenCabinetId: null, addScreenDraft: null }),
  startCabinetFromAddScreen: (draft) => set({ dialog: "new-cabinet", returnToAddScreen: true, addScreenDraft: draft }),
  finishCabinet: (cabinetId) =>
    set((state) =>
      state.returnToAddScreen
        ? { dialog: "add-screen", returnToAddScreen: false, addScreenCabinetId: cabinetId }
        : { dialog: null },
    ),
  askConfirm: (confirm) => set({ confirm }),
}));
