import type { StudioId } from "@/modules/contract";
import { deleteSelection, duplicateSelection, nudgeSelection } from "@/state/actions";
import { historyShortcut, type KeyPress } from "@/state/shortcuts";
import { useApp } from "@/state/store";

/**
 * The workspace's keyboard shortcuts, decided without a DOM so the rule can be tested:
 * - canvas and mapping keys (Delete, Backspace, arrows, ⌘D, Esc) act only in the Mapping studio, with focus on the
 *   mapping canvas, its lists in the explorer, or nothing;
 * - undo and redo act in any studio;
 * - nothing acts while typing in a field, with a dialog or menu open, or while Fast map (which has its own keys) is open.
 * ⌘S saves everywhere, as before.
 */
export type WorkspaceAction =
  | { kind: "save" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "duplicate" }
  | { kind: "delete" }
  | { kind: "deselect" }
  | { kind: "nudge"; dx: number; dy: number };

export interface WorkspaceKeyContext {
  studio: StudioId;
  hasProject: boolean;
  fastMapOpen: boolean;
  /** Focus is in a text field, select, combobox or editable element. */
  typing: boolean;
  /** A dialog or menu is open. */
  dialogOpen: boolean;
  /** Focus is on the mapping canvas, the explorer, or nothing (the page itself). */
  inMappingScope: boolean;
}

export function workspaceAction(e: KeyPress, ctx: WorkspaceKeyContext): WorkspaceAction | null {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "s") return { kind: "save" };
  if (!ctx.hasProject || ctx.fastMapOpen || ctx.typing || ctx.dialogOpen) return null;
  const step = historyShortcut(e);
  if (step) return { kind: step };
  if (ctx.studio !== "mapping" || !ctx.inMappingScope) return null;
  if (mod && !e.altKey && e.key.toLowerCase() === "d") return { kind: "duplicate" };
  if (mod || e.altKey) return null;
  if (e.key === "Delete" || e.key === "Backspace") return { kind: "delete" };
  if (e.key === "Escape") return { kind: "deselect" };
  if (e.key.startsWith("Arrow")) {
    const n = e.shiftKey ? 10 : 1;
    return { kind: "nudge", dx: e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0, dy: e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0 };
  }
  return null;
}

export function runWorkspaceAction(action: WorkspaceAction): void {
  const app = useApp.getState();
  switch (action.kind) {
    case "save":
      void app.save();
      return;
    case "undo":
      app.undo();
      return;
    case "redo":
      app.redo();
      return;
    case "duplicate":
      duplicateSelection();
      return;
    case "delete":
      deleteSelection();
      return;
    case "deselect":
      app.select({ kind: "none" });
      return;
    case "nudge":
      nudgeSelection(action.dx, action.dy);
      return;
  }
}

/** Selectors for where mapping keys may act, besides the page itself. */
export const MAPPING_SCOPE = 'main[aria-label="Interactive canvas"], aside[aria-label="Project explorer"]';
