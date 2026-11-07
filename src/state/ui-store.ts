"use client";

import { create } from "zustand";

export type DialogName = "new-project" | "open-project" | "add-screen" | "new-cabinet" | "preview";

export interface ConfirmRequest {
  title: string;
  body: string;
  action: string;
  onConfirm: () => void | Promise<void>;
}

interface UiState {
  dialog: DialogName | null;
  confirm: ConfirmRequest | null;
  /** Set while New cabinet was opened from Add screen: holds the cabinet to preselect on return. */
  addScreenCabinetId: string | null;
  returnToAddScreen: boolean;
  openDialog(dialog: DialogName | null): void;
  startCabinetFromAddScreen(): void;
  finishCabinet(cabinetId: string): void;
  askConfirm(request: ConfirmRequest | null): void;
}

export const useUi = create<UiState>((set) => ({
  dialog: null,
  confirm: null,
  addScreenCabinetId: null,
  returnToAddScreen: false,
  openDialog: (dialog) => set({ dialog, returnToAddScreen: false, addScreenCabinetId: null }),
  startCabinetFromAddScreen: () => set({ dialog: "new-cabinet", returnToAddScreen: true }),
  finishCabinet: (cabinetId) =>
    set((state) =>
      state.returnToAddScreen
        ? { dialog: "add-screen", returnToAddScreen: false, addScreenCabinetId: cabinetId }
        : { dialog: null },
    ),
  askConfirm: (confirm) => set({ confirm }),
}));
