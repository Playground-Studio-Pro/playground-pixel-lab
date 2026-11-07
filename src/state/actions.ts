"use client";

import { toast } from "sonner";
import type { Id, Project } from "@/domain/model";
import { px, um, type Rect } from "@/domain/units";
import { alignItems, type AlignMode } from "@/engines/align";
import * as ops from "@/engines/project-ops";
import { opContext, selectedScreenIds, useApp, type EditOptions } from "./store";
import { useUi } from "./ui-store";
import { buildViewModel } from "./view-model";

export function reportError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

/** Runs an edit, turning domain errors into a visible message. */
export function tryEdit(change: (project: Project) => Project, options?: EditOptions) {
  try {
    useApp.getState().edit(change, options);
  } catch (error) {
    reportError(error);
  }
}

/** Applies positions expressed in the current view's world units. */
export function moveInCurrentView(positions: readonly { id: Id; x: number; y: number }[], options?: EditOptions) {
  const { view } = useApp.getState();
  tryEdit((project) => {
    switch (view) {
      case "physical":
        return ops.setStagePositions(project, positions.map((p) => ({ id: p.id, x: um(p.x), y: um(p.y) })));
      case "content":
        return ops.setMasterPositions(project, positions.map((p) => ({ id: p.id, x: px(p.x), y: px(p.y) })));
      case "output":
        return ops.setSlicePositions(project, positions.map((p) => ({ id: p.id, x: px(p.x), y: px(p.y) })));
    }
  }, options);
}

function selectedViewItems() {
  const { project, mapping, view, activeOutputId, selection } = useApp.getState();
  if (!project || !mapping) return { items: [], quantum: 1 };
  const model = buildViewModel(project, mapping, view, activeOutputId);
  const ids = new Set(selectedScreenIds(selection, project));
  return { items: model.items.filter((i) => ids.has(i.id)), quantum: model.quantum };
}

export function nudgeSelection(dx: number, dy: number) {
  const { items, quantum } = selectedViewItems();
  if (items.length === 0) return;
  // A held or repeated arrow key undoes as one move.
  const coalesce = `nudge:${useApp.getState().view}:${items.map((i) => i.id).join(",")}`;
  moveInCurrentView(items.map((i) => ({ id: i.id, x: i.rect.x + dx * quantum, y: i.rect.y + dy * quantum })), { coalesce });
}

export function alignSelection(mode: AlignMode) {
  const { items } = selectedViewItems();
  if (items.length < 2) return;
  moveInCurrentView(alignItems(items.map((i) => ({ id: i.id, rect: i.rect as Rect<number> })), mode));
}

export function duplicateSelection() {
  const { project, selection, select } = useApp.getState();
  const ids = selectedScreenIds(selection, project);
  if (ids.length === 0) return;
  const created: Id[] = [];
  tryEdit((current) => {
    let next = current;
    for (const id of ids) {
      const result = ops.duplicateScreen(next, id, opContext);
      next = result.project;
      created.push(result.newId);
    }
    return next;
  });
  if (created.length > 0) select({ kind: "screens", ids: created });
}

export function deleteSelection() {
  const { project, selection, select } = useApp.getState();
  const ids = selectedScreenIds(selection, project);
  if (!project || ids.length === 0) return;
  const names = project.physical.screens.filter((s) => ids.includes(s.id)).map((s) => s.name);
  useUi.getState().askConfirm({
    title: names.length === 1 ? `Delete “${names[0]}”?` : `Delete ${names.length} screens?`,
    body: names.length === 1
      ? "This removes the screen and its content and output mapping. Undo with ⌘Z."
      : "This removes the screens and their content and output mapping. Undo with ⌘Z.",
    action: names.length === 1 ? "Delete screen" : "Delete screens",
    onConfirm: () => {
      tryEdit((current) => ops.deleteScreens(current, ids));
      select({ kind: "none" });
    },
  });
}

export function groupSelection() {
  const { project, selection, select } = useApp.getState();
  if (!project || selection.kind !== "screens") return;
  let groupId: Id | null = null;
  tryEdit((current) => {
    const result = ops.groupScreens(current, selection.ids, `Group ${current.physical.groups.length + 1}`, opContext);
    groupId = result.groupId;
    return result.project;
  });
  if (groupId) select({ kind: "group", id: groupId });
}
